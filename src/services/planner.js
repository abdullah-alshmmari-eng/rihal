import { destinations, getTravelTime } from "../data/mockData.js";
import { generateGeminiContent } from "./geminiService.js";

// Helper: Convert hours to time string (e.g. 9.5 -> "09:30")
export function formatTime(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  const hPad = String(h).padStart(2, "0");
  const mPad = String(m).padStart(2, "0");
  return `${hPad}:${mPad}`;
}

// Helper: Convert time string like "09:30" to decimal hours
export function parseTime(timeStr) {
  if (!timeStr) return 9.0;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  return h + (m / 60);
}

// Prayer times mapping
const PRAYERS = [
  { name: "الظهر", time: 12.33, label: "صلاة الظهر" },  // 12:20
  { name: "العصر", time: 15.75, label: "صلاة العصر" },  // 15:45
  { name: "المغرب", time: 18.83, label: "صلاة المغرب" }, // 18:50
  { name: "العشاء", time: 20.33, label: "صلاة العشاء" }  // 20:20
];

// Main Async Itinerary Generator with Gemini AI Reasoning & Automatic Deterministic Fallback
export async function generateItineraryAsync(preferences, modifiers = {}, currentItinerary = null) {
  try {
    const geminiResult = await generateItineraryWithGemini(preferences, modifiers, currentItinerary);
    if (geminiResult && geminiResult.days && geminiResult.days.length > 0) {
      console.log("✅ [Gemini AI Engine]: Successfully generated/replanned itinerary via Gemini reasoning.");
      return geminiResult;
    }
  } catch (err) {
    console.warn("⚠️ [Gemini AI Fallback Triggered]:", err.message);
  }

  // Deterministic Fallback Engine
  const fallbackItinerary = generateItinerary(preferences, modifiers);
  fallbackItinerary.decisions = fallbackItinerary.decisions || [];
  fallbackItinerary.decisions.unshift("🛡️ تم استخدام نظام التخطيط المعياري (Deterministic Fallback Engine)");
  return fallbackItinerary;
}

async function generateItineraryWithGemini(preferences, modifiers = {}, currentItinerary = null) {
  const {
    destination: destId,
    duration = 1,
    interests = [],
    mobility = "normal",
    maxWalking = 2000,
    startTime = "09:00",
    availableHours = 8
  } = preferences;

  const cityData = destinations[destId];
  if (!cityData) return null;

  const rawPois = cityData.poi || [];
  const candidateList = rawPois.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    interests: p.interests || [],
    durationMinutes: p.durationMinutes || (p.duration ? p.duration * 60 : 120),
    walkingDistanceMeters: p.walkingDistanceMeters !== undefined ? p.walkingDistanceMeters : (p.walkingDistance || 500),
    wheelchairFriendly: p.accessibility ? !!p.accessibility.wheelchair : !!p.wheelchairFriendly,
    elderlyFriendly: p.accessibility ? !!p.accessibility.elderly : !!p.elderlyFriendly,
    type: p.type || "outdoor",
    description: p.description || ""
  }));

  // Identify active disruption from modifiers
  let disruptionPrompt = "";
  if (modifiers.highHeat) {
    disruptionPrompt = `حدث طارئ: الحرارة ارتفعت بشكل ملحوظ!
المطلوب:
1. تقليل التعرض في الأماكن الخارجية المفتوحة خلال أوقات الذروة الحارة.
2. إعطاء الأولوية للمعالم المغلقة والمكيفة أو الأنشطة المسائية والظل من القائمة المتاحة.
3. الحفاظ على المعالم المناسبة وإعادة ترتيب أو استبدال المعالم الخارجية الشديدة إذا لزم الأمر.`;
  } else if (modifiers.reduceWalking) {
    disruptionPrompt = `حدث طارئ: خفض أقصى مسافة مشي مسموحة!
المطلوب:
1. استبعاد أو استبدال أي معلم يتطلب مشياً يزيد عن الحد الأقصى للمشي (${maxWalking} متر).
2. إعطاء الأولوية للمعالم ذات مسافات المشي الخفيفة والقريبة.
3. الحفاظ على المعالم المتبقية وإعادة ترتيب الجدول.`;
  } else if (modifiers.highTraffic) {
    disruptionPrompt = `حدث طارئ: تقليل أوقات المسافات والتنقل المروري!
المطلوب:
1. تقليل مسافات وأوقات التنقل بين المعالم من خلال إعادة ترتيب وتسلسل الأنشطة حسب القرب الجغرافي والبيانات المتاحة.
2. عدم اختراع حالات زحام وهمية، بل الاستفادة من بيانات المسافات والترتيب الجغرافي لتقليل زمن التنقل التقديري.`;
  } else if (modifiers.prayerBuffer) {
    disruptionPrompt = `تعديل مطلوب: إضافة وقت مناسب للصلاة والراحة!
المطلوب:
1. مراعاة إدراج فترات استراحة للصلاة بين الأنشطة دون إلغاء خطة اليوم.
2. إزاحة وتنسيق الأنشطة التالية بمرونة مع الحفاظ على أكبر عدد ممكن من المعالم الأصلية.`;
  } else if (modifiers.swapPoiId) {
    disruptionPrompt = `طلب استبدال: يرغب المستخدم في استبدال المعلم ذو المعرف (${modifiers.swapPoiId})!
المطلوب:
1. اختيار معلم بديل جديد من قائمة المعالم المتاحة لم يتم استخدامه بعد ويناسب تفضيلات المستخدم.
2. الحفاظ على بقية الجدول كما هو قدر الإمكان.`;
  } else if (modifiers.forceReplan) {
    disruptionPrompt = `إعادة تحسين شاملة: مطلوب إعادة تحسين مسار الرحلة بالكامل حسب تفضيلات المستخدم مع الحفاظ على الأيام وتنسيق الجدول.`;
  }

  // Current Schedule summary string if present
  let currentScheduleContext = "";
  if (currentItinerary && currentItinerary.days) {
    const existingDays = currentItinerary.days.map(d => ({
      dayNumber: d.dayNumber,
      poiIds: d.activities ? d.activities.filter(a => a.isPoi).map(a => a.poiId) : []
    }));
    currentScheduleContext = `الجدول الحالي الحالي:\n${JSON.stringify(existingDays, null, 2)}`;
  }

  const systemPrompt = `أنت المساعد الذكي لتخطيط الرحلات لـ (رِحال).
المطلوب منك اختيار وتوزيع المعالم السياحية المقدمة في القائمة لإنشاء خطة رحلة متكاملة لـ ${duration} يوم (أيام) في مدينة ${cityData.name}.

تفضيلات المستخدم:
- الوجهة: ${cityData.name}
- عدد الأيام: ${duration}
- وقت البدء اليومي: ${startTime}
- الساعات المتاحة يومياً: ${availableHours} ساعة
- الاهتمامات المختارة: ${interests.join(', ') || 'عام'}
- مستوى الحركة: ${mobility}
- أقصى مسافة مشي: ${maxWalking} متر

${currentScheduleContext ? currentScheduleContext + '\n' : ''}
${disruptionPrompt ? disruptionPrompt + '\n' : ''}

قائمة المعالم المتاحة:
${JSON.stringify(candidateList, null, 2)}

قواعد التخطيط الحاسمة:
1. اختر فقط من معالم القائمة أعلاه (استخدم المرفق id). يمنع منعاً باتاً اختراع معلم جديد غير موجود بالقائمة!
2. وزع المعالم على الأيام من 1 إلى ${duration}. يجب أن يحتوي كل يوم على نشاطين أو أكثر.
3. حافظ على أكبر عدد ممكن من الأنشطة الحالية المناسبة، ولا تستبدل المعلم إلا إذا كان غير مناسب للحدث الطارئ.
4. راعِ مسافة المشي وملاءمة الكراسي المتحركة أو كبار السن إذا كانت الحركة محدودة.
5. رتب المعالم منطقياً حسب المدة والمسافة والتسلسل الزمني.
6. أعد النتيجة فقط بصيغة JSON بالنص التالي دون أي مقدمات:
{
  "explanation": "سبب توجيه وتنسيق الخطة باللغة العربية شارحاً التعديلات المنجزة",
  "days": [
    {
      "dayNumber": 1,
      "poiIds": ["id1", "id2"]
    }
  ]
}`;

  const geminiRawResponse = await generateGeminiContent(systemPrompt);

  if (!geminiRawResponse || geminiRawResponse.error) {
    throw new Error(geminiRawResponse?.error || "Gemini proxy call returned error");
  }

  let responseText = "";
  if (geminiRawResponse.candidates && geminiRawResponse.candidates[0]?.content?.parts[0]?.text) {
    responseText = geminiRawResponse.candidates[0].content.parts[0].text;
  } else if (typeof geminiRawResponse === "string") {
    responseText = geminiRawResponse;
  } else {
    throw new Error("Invalid Gemini proxy response shape");
  }

  let cleanJson = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
  const parsedObj = JSON.parse(cleanJson);

  // 5-Step Validation
  validateGeminiReplanResponse(parsedObj, preferences, candidateList);

  return buildItineraryFromGeminiSchedule(parsedObj, preferences, modifiers, cityData, candidateList);
}

function validateGeminiReplanResponse(parsedObj, preferences, candidateList) {
  if (!parsedObj || typeof parsedObj !== "object") {
    throw new Error("Gemini response is not a valid JSON object");
  }
  if (!Array.isArray(parsedObj.days) || parsedObj.days.length === 0) {
    throw new Error("Gemini response missing valid days array");
  }

  const { duration = 1, mobility = "normal" } = preferences;
  if (parsedObj.days.length !== duration) {
    throw new Error(`Gemini days count (${parsedObj.days.length}) does not match trip duration (${duration})`);
  }

  const validPoiIds = new Set(candidateList.map(p => p.id));

  parsedObj.days.forEach((d, idx) => {
    if (d.dayNumber !== idx + 1) {
      throw new Error(`Invalid or non-sequential dayNumber ${d.dayNumber} at index ${idx}`);
    }
    if (!Array.isArray(d.poiIds) || d.poiIds.length === 0) {
      throw new Error(`Day ${d.dayNumber} has no selected POI IDs`);
    }

    d.poiIds.forEach(id => {
      if (!validPoiIds.has(id)) {
        throw new Error(`Hallucinated or invalid POI ID '${id}' returned by Gemini`);
      }
    });
  });

  return true;
}

function buildItineraryFromGeminiSchedule(geminiPlan, preferences, modifiers, cityData, candidateList) {
  const {
    duration = 1,
    mobility = "normal",
    startTime = "09:00"
  } = preferences;

  const isHighHeat = !!modifiers.highHeat;
  const isHighTraffic = !!modifiers.highTraffic;
  const isPrayerBuffer = !!modifiers.prayerBuffer;
  const trafficMultiplier = isHighTraffic ? 1.8 : 1.0;

  const poiMap = new Map();
  candidateList.forEach(p => poiMap.set(p.id, p));

  const decisions = [];
  decisions.push("🤖 تم تخطيط هذه الرحلة بواسطة الذكاء الاصطناعي (Gemini 2.5 Flash API)");

  if (geminiPlan.explanation) {
    decisions.push(`💡 تحليل الذكاء الاصطناعي: ${geminiPlan.explanation}`);
  }

  const days = [];
  const parsedStartHour = parseTime(startTime);

  for (let d = 1; d <= duration; d++) {
    const dayPlan = geminiPlan.days.find(item => item.dayNumber === d) || geminiPlan.days[d - 1];
    const poiIds = (dayPlan && Array.isArray(dayPlan.poiIds)) ? dayPlan.poiIds : [];
    
    const dayActivities = [];
    let currentHours = parsedStartHour;
    let lastPoi = null;

    poiIds.forEach(id => {
      const poiData = poiMap.get(id);
      if (!poiData) return;

      const durationHours = poiData.durationMinutes / 60;
      let travelMinutes = lastPoi ? Math.round(getTravelTime(lastPoi.id, poiData.id) * trafficMultiplier) : 0;
      let travelHours = travelMinutes / 60;

      if (lastPoi && travelMinutes > 0) {
        if (isPrayerBuffer) {
          const arrivalTime = currentHours + travelHours;
          const prayer = PRAYERS.find(p => p.time >= currentHours && p.time <= arrivalTime + 0.1);
          if (prayer) {
            dayActivities.push({
              isPrayerSlot: true,
              name: `🕌 وقفة لصلاة ${prayer.name} والراحة`,
              startTime: formatTime(currentHours),
              endTime: formatTime(currentHours + 0.5),
              duration: "30 دقيقة",
              details: `تمت جدولة وقت كافٍ لأداء صلاة ${prayer.name} في أقرب مسجد متاح.`
            });
            currentHours += 0.5;
            travelMinutes = Math.round(getTravelTime(lastPoi.id, poiData.id) * trafficMultiplier);
            travelHours = travelMinutes / 60;
          }
        }

        dayActivities.push({
          isTransit: true,
          durationText: `${travelMinutes} دقيقة`,
          typeText: isHighTraffic ? "🚗 حركة مرور مزدحمة" : "🚗 طريق منساب",
          durationVal: travelMinutes
        });
        currentHours += travelHours;
      }

      if (isPrayerBuffer) {
        const activityEndTime = currentHours + durationHours;
        const midPrayer = PRAYERS.find(p => p.time >= currentHours && p.time < activityEndTime - 0.2);
        if (midPrayer) {
          dayActivities.push({
            isPrayerSlot: true,
            name: `🕌 وقفة لصلاة ${midPrayer.name} والراحة`,
            startTime: formatTime(currentHours),
            endTime: formatTime(currentHours + 0.5),
            duration: "30 دقيقة",
            details: `فترة راحة وأداء صلاة ${midPrayer.name} قبل بدء الفعالية التالية.`
          });
          currentHours += 0.5;
        }
      }

      const startStr = formatTime(currentHours);
      currentHours += durationHours;
      const endStr = formatTime(currentHours);

      const accessibilityAlerts = [];
      if (mobility === "wheelchair") {
        if (poiData.wheelchairFriendly) {
          accessibilityAlerts.push("♿ مسار مهيأ ومسطح بالكامل");
        } else {
          accessibilityAlerts.push("⚠️ تنبيه: يتطلب مساعدة - بعض المسارات مائلة أو غير معبدة");
        }
      } else if (mobility === "elderly") {
        if (poiData.elderlyFriendly) {
          accessibilityAlerts.push("🚶 مسافة مشي قصيرة وتتوفر مقاعد للراحة");
        } else {
          accessibilityAlerts.push("⚠️ تنبيه: مسافات مشي طويلة نسبياً");
        }
      }

      if (isHighHeat && poiData.type === "outdoor") {
        accessibilityAlerts.push("🔥 تنبيه حراري: المكان مفتوح ومكشوف، ننصح بالمظلة وشرب الماء");
      }

      dayActivities.push({
        isPoi: true,
        poiId: poiData.id,
        name: poiData.name,
        category: poiData.category,
        type: poiData.type,
        duration: `${durationHours} ساعة`,
        walkingDistance: `${poiData.walkingDistanceMeters} متر`,
        walkingLevelText: poiData.walkingDistanceMeters < 500 ? "مشي قليل جداً" : poiData.walkingDistanceMeters < 1200 ? "مشي متوسط" : "مشي طويل",
        description: poiData.description,
        whySelected: "اختيار موجه بالذكاء الاصطناعي بناءً على ملاءمة المكان واهتماماتك",
        wheelchairFriendly: poiData.wheelchairFriendly,
        startTime: startStr,
        endTime: endStr,
        accessibilityAlerts
      });

      lastPoi = poiData;
    });

    days.push({
      dayNumber: d,
      activities: dayActivities
    });
  }

  const hasEmptyDay = days.some(day => day.activities.filter(a => a.isPoi).length === 0);
  if (hasEmptyDay) {
    throw new Error("Gemini plan generated an empty day");
  }

  return {
    destinationName: cityData.name,
    days,
    decisions,
    explanation: geminiPlan.explanation || "تم تنسيق الجدول الذكي بنجاح بطلب من محرك Gemini."
  };
}

export function generateItinerary(preferences, modifiers = {}) {
  const {
    destination: destId,
    groupSize = 1,
    duration = 1, // days
    interests = [],
    mobility = "normal",
    maxWalking = 2000,
    startTime = "09:00",
    availableHours = 8
  } = preferences;

  // Active modifiers (dynamic replanning options)
  const isHighHeat = !!modifiers.highHeat;
  const isReduceWalking = !!modifiers.reduceWalking;
  const isHighTraffic = !!modifiers.highTraffic;
  const isPrayerBuffer = !!modifiers.prayerBuffer;
  const forceReplan = !!modifiers.forceReplan;
  const customSwapId = modifiers.swapPoiId || null;

  // Fetch available POIs
  const cityData = destinations[destId];
  if (!cityData) {
    return { error: `الموقع ${destId} غير مدعوم حالياً.` };
  }

  // Calculate actual limits based on modifiers
  const actualMaxWalking = isReduceWalking ? Math.min(600, maxWalking) : maxWalking;

  // Track decisions
  const decisions = [
    `الوجهة المختارة: ${cityData.name}`,
    `عدد المسافرين: ${groupSize}`,
    `مدة الرحلة: ${duration} أيام`,
    `ساعات التجول المتاحة: ${availableHours} ساعات يومياً`,
    `وقت البدء المفضل: ${startTime}`
  ];

  if (mobility === "wheelchair") {
    decisions.push("♿ إعطاء الأولوية القصوى للمواقع المهيأة للكراسي المتحركة");
  } else if (mobility === "elderly") {
    decisions.push("👵 مراعاة كبار السن بمعدلات مشي منخفضة ومسارات مريحة");
  }

  decisions.push(`🚶 الحد الأقصى للمشي لكل نشاط: ${actualMaxWalking} متر`);

  if (isHighHeat) {
    decisions.push("🔥 وضع الحماية من الحرارة: تجنب المواقع المكشوفة من 11:30 ص إلى 4:00 م");
  }
  if (isReduceWalking) {
    decisions.push("♿ تقليل المشي: تم تخفيض حد مسافة المشي إلى 600 متر كحد أقصى");
  }
  if (isHighTraffic) {
    decisions.push("🚗 زحمة مرورية عالية: مضاعفة وقت التنقل وجدولة الأنشطة المتقاربة");
  }
  if (isPrayerBuffer) {
    decisions.push("🕌 مراعاة أوقات الصلاة: حجز 30 دقيقة وقت الأذان بالقرب من المساجد");
  }

  // 1. Preprocess POIs to fix schema mismatches
  const rawPois = cityData.poi || [];
  const processedPois = rawPois.map(poi => {
    let poiDuration = 2.0; // default fallback 2 hours
    if (poi.durationMinutes) {
      poiDuration = poi.durationMinutes / 60;
    } else if (poi.duration) {
      poiDuration = poi.duration;
    }

    const walkingDistance = poi.walkingDistanceMeters !== undefined ? poi.walkingDistanceMeters : (poi.walkingDistance !== undefined ? poi.walkingDistance : 500);

    let wheelchairFriendly = false;
    let elderlyFriendly = false;
    if (poi.accessibility) {
      wheelchairFriendly = !!poi.accessibility.wheelchair;
      elderlyFriendly = !!poi.accessibility.elderly;
    } else {
      wheelchairFriendly = !!poi.wheelchairFriendly;
      elderlyFriendly = !!poi.elderlyFriendly;
    }

    const baseRating = poi.baseRating !== undefined ? poi.baseRating : 4.5;
    const category = poi.category || "";
    const poiInterests = poi.interests || [];

    return {
      ...poi,
      duration: poiDuration,
      walkingDistance,
      wheelchairFriendly,
      elderlyFriendly,
      baseRating,
      category,
      interests: poiInterests
    };
  });

  // Check interest alignment helper:
  // A POI matches selected interests if any selected interest is in poi.interests array or matches category
  function poiMatchesInterests(poi) {
    if (!interests || interests.length === 0) return true;
    return interests.some(interest => {
      if (poi.interests && poi.interests.includes(interest)) return true;
      if (poi.category === interest) return true;
      if (interest === "التاريخ" && (poi.category === "historical" || poi.category === "culture")) return true;
      if (interest === "الثقافة" && (poi.category === "culture" || poi.category === "historical")) return true;
      if (interest === "الطعام" && poi.category === "restaurant") return true;
      if (interest === "الطبيعة" && poi.category === "nature") return true;
      if (interest === "التصوير" && (poi.category === "photography" || poi.category === "entertainment")) return true;
      return false;
    });
  }

  // Build candidate pool using expansion ladder to guarantee enough POIs for multi-day trips
  const neededPois = duration * 2; // e.g. 6 POIs for 3 days (at least 2 per day)
  const poolMap = new Map();

  // Level 1: Strict match (interests + walking limit + wheelchair constraint)
  processedPois.forEach(poi => {
    if (!poiMatchesInterests(poi)) return;
    const meetsWalking = poi.walkingDistance <= actualMaxWalking;
    const meetsWheelchair = (mobility !== "wheelchair") || poi.wheelchairFriendly;
    
    if (meetsWalking && meetsWheelchair) {
      poolMap.set(poi.id, { poi, penalty: 0 });
    }
  });

  // Level 2: If pool size is less than neededPois, expand walking distance & accessibility constraints
  if (poolMap.size < neededPois) {
    processedPois.forEach(poi => {
      if (poolMap.has(poi.id)) return;
      if (!poiMatchesInterests(poi)) return;
      
      let penalty = 0;
      if (poi.walkingDistance > actualMaxWalking) {
        penalty += (poi.walkingDistance - actualMaxWalking) * 0.05;
      }
      if (mobility === "wheelchair" && !poi.wheelchairFriendly) {
        penalty += 30;
      }
      poolMap.set(poi.id, { poi, penalty });
    });
  }

  // Level 3: If still less than neededPois, include any remaining POIs in the city dataset to prevent empty days
  if (poolMap.size < neededPois) {
    processedPois.forEach(poi => {
      if (poolMap.has(poi.id)) return;
      poolMap.set(poi.id, { poi, penalty: 50 });
    });
  }

  let candidateEntries = Array.from(poolMap.values());
  if (customSwapId) {
    candidateEntries = candidateEntries.filter(entry => entry.poi.id !== customSwapId);
  }

  if (candidateEntries.length === 0) {
    return {
      destinationName: cityData.name,
      days: Array.from({ length: duration }, (_, i) => ({ dayNumber: i + 1, activities: [] })),
      decisions,
      explanation: "لا توجد أنشطة مناسبة كافية ضمن القيود الحالية لمطابقة اهتماماتك ومحددات الحركة والوقت."
    };
  }

  // 2. Score candidates
  const scoredPool = candidateEntries.map(entry => {
    const poi = entry.poi;
    let score = 100 - entry.penalty;

    const matchesInterest = interests.some(interest => poi.interests.includes(interest));
    if (matchesInterest) {
      score += 100;
    }
    
    score += poi.baseRating * 10;
    
    if (mobility === "elderly" && poi.elderlyFriendly) {
      score += 20;
    }

    if (isHighHeat && poi.type === "outdoor") {
      score -= 30;
    }

    return { ...poi, score };
  });

  scoredPool.sort((a, b) => b.score - a.score);

  // 3. Balanced Day Distribution & Routing
  const trafficMultiplier = isHighTraffic ? 1.8 : 1.0;
  let activePool = [...scoredPool];
  const days = [];

  const scheduledCounts = {};
  interests.forEach(interest => {
    scheduledCounts[interest] = 0;
  });

  const parsedStartHour = parseTime(startTime);

  for (let d = 1; d <= duration; d++) {
    const dayActivities = [];
    let currentHours = parsedStartHour;
    const baseDayEndLimit = Math.min(23.99, parsedStartHour + availableHours);
    let lastPoi = null;

    const remainingDays = duration - d + 1;
    const remainingPois = activePool.length;
    const targetForThisDay = Math.max(2, Math.min(4, Math.ceil(remainingPois / remainingDays)));

    while (
      dayActivities.filter(a => a.isPoi).length < targetForThisDay &&
      activePool.length > 0
    ) {
      const currentPoiCount = dayActivities.filter(a => a.isPoi).length;

      let bestNextIndex = -1;
      let bestDynamicScore = -Infinity;

      for (let i = 0; i < activePool.length; i++) {
        const candidate = activePool[i];

        let travelMinutes = 0;
        if (lastPoi) {
          travelMinutes = Math.round(getTravelTime(lastPoi.id, candidate.id) * trafficMultiplier);
        }
        const travelHours = travelMinutes / 60;

        const potentialEndTime = currentHours + travelHours + candidate.duration;
        const isFirstActivity = currentPoiCount === 0;

        // If it's the 1st or 2nd activity of the day, allow slight time flex (up to +1.0 hour) if needed to guarantee multiple activities per day
        const maxAllowedEnd = (currentPoiCount < 2) ? Math.min(23.99, baseDayEndLimit + 1.0) : baseDayEndLimit;

        if (!isFirstActivity && potentialEndTime > maxAllowedEnd) {
          continue;
        }

        let balanceBonus = 0;
        const matchedSelectedInterests = interests.filter(x => candidate.interests.includes(x));
        matchedSelectedInterests.forEach(interest => {
          balanceBonus += 150 / (1 + (scheduledCounts[interest] || 0));
        });

        const travelPenalty = travelMinutes * 2.0;
        const dynamicScore = candidate.score + balanceBonus - travelPenalty;

        if (dynamicScore > bestDynamicScore) {
          bestDynamicScore = dynamicScore;
          bestNextIndex = i;
        }
      }

      if (bestNextIndex === -1) {
        break;
      }

      const poi = activePool[bestNextIndex];
      let travelMinutes = lastPoi ? Math.round(getTravelTime(lastPoi.id, poi.id) * trafficMultiplier) : 0;
      let travelHours = travelMinutes / 60;

      activePool.splice(bestNextIndex, 1);

      if (isHighHeat && poi.type === "outdoor" && currentHours >= 11.5 && currentHours <= 16.0) {
        let replacementIdx = -1;
        let bestReplacementScore = -Infinity;

        for (let i = 0; i < activePool.length; i++) {
          const candidate = activePool[i];
          if (candidate.type !== "indoor") continue;

          let travelMin = lastPoi ? Math.round(getTravelTime(lastPoi.id, candidate.id) * trafficMultiplier) : 0;
          let travelH = travelMin / 60;
          const potEndTime = currentHours + travelH + candidate.duration;
          const isFirst = currentPoiCount === 0;
          const maxAllowedEnd = (currentPoiCount < 2) ? Math.min(23.99, baseDayEndLimit + 1.0) : baseDayEndLimit;

          if (!isFirst && potEndTime > maxAllowedEnd) {
            continue;
          }

          let balBonus = 0;
          const matchedInterests = interests.filter(x => candidate.interests.includes(x));
          matchedInterests.forEach(interest => {
            balBonus += 150 / (1 + (scheduledCounts[interest] || 0));
          });

          const travPenalty = travelMin * 2.0;
          const dynScore = candidate.score + balBonus - travPenalty;

          if (dynScore > bestReplacementScore) {
            bestReplacementScore = dynScore;
            replacementIdx = i;
          }
        }

        if (replacementIdx !== -1) {
          const replacementPoi = activePool[replacementIdx];
          activePool.splice(replacementIdx, 1);
          activePool.push(poi);
          
          schedulePoi(replacementPoi);
        } else {
          schedulePoi(poi, true);
        }
      } else {
        schedulePoi(poi);
      }

      function schedulePoi(selectedPoi, heatWarning = false) {
        if (lastPoi && travelMinutes > 0) {
          if (isPrayerBuffer) {
            const arrivalTime = currentHours + travelHours;
            const prayer = PRAYERS.find(p => p.time >= currentHours && p.time <= arrivalTime + 0.1);
            if (prayer) {
              dayActivities.push({
                isPrayerSlot: true,
                name: `🕌 وقفة لصلاة ${prayer.name} والراحة`,
                startTime: formatTime(currentHours),
                endTime: formatTime(currentHours + 0.5),
                duration: "30 دقيقة",
                details: `تمت جدولة وقت كافٍ لأداء صلاة ${prayer.name} في أقرب مسجد متاح.`
              });
              currentHours += 0.5;
              travelMinutes = Math.round(getTravelTime(lastPoi.id, selectedPoi.id) * trafficMultiplier);
              travelHours = travelMinutes / 60;
            }
          }

          dayActivities.push({
            isTransit: true,
            durationText: `${travelMinutes} دقيقة`,
            typeText: isHighTraffic ? "🚗 حركة مرور مزدحمة" : "🚗 طريق منساب",
            durationVal: travelMinutes
          });
          currentHours += travelHours;
        }

        if (isPrayerBuffer) {
          const activityEndTime = currentHours + selectedPoi.duration;
          const midPrayer = PRAYERS.find(p => p.time >= currentHours && p.time < activityEndTime - 0.2);
          if (midPrayer) {
            dayActivities.push({
              isPrayerSlot: true,
              name: `🕌 وقفة لصلاة ${midPrayer.name} والراحة`,
              startTime: formatTime(currentHours),
              endTime: formatTime(currentHours + 0.5),
              duration: "30 دقيقة",
              details: `فترة راحة وأداء صلاة ${midPrayer.name} قبل بدء الفعالية التالية.`
            });
            currentHours += 0.5;
          }
        }

        const startStr = formatTime(currentHours);
        currentHours += selectedPoi.duration;
        const endStr = formatTime(currentHours);

        const accessibilityAlerts = [];
        if (mobility === "wheelchair") {
          if (selectedPoi.wheelchairFriendly) {
            accessibilityAlerts.push("♿ مسار مهيأ ومسطح بالكامل");
          } else {
            accessibilityAlerts.push("⚠️ تنبيه: يتطلب مساعدة - بعض المسارات مائلة أو غير معبدة");
          }
        } else if (mobility === "elderly") {
          if (selectedPoi.elderlyFriendly) {
            accessibilityAlerts.push("🚶 مسافة مشي قصيرة وتتوفر مقاعد للراحة");
          } else {
            accessibilityAlerts.push("⚠️ تنبيه: مسافات مشي طويلة نسبياً");
          }
        }

        if (isHighHeat && selectedPoi.type === "outdoor" && heatWarning) {
          accessibilityAlerts.push("🔥 تنبيه حراري: المكان مفتوح ومكشوف، ننصح بالمظلة وشرب الماء");
        }

        dayActivities.push({
          isPoi: true,
          poiId: selectedPoi.id,
          name: selectedPoi.name,
          category: selectedPoi.category,
          type: selectedPoi.type,
          duration: `${selectedPoi.duration} ساعة`,
          walkingDistance: `${selectedPoi.walkingDistance} متر`,
          walkingLevelText: selectedPoi.walkingDistance < 500 ? "مشي قليل جداً" : selectedPoi.walkingDistance < 1200 ? "مشي متوسط" : "مشي طويل",
          description: selectedPoi.description,
          whySelected: selectedPoi.whySelectedText,
          wheelchairFriendly: selectedPoi.wheelchairFriendly,
          startTime: startStr,
          endTime: endStr,
          accessibilityAlerts
        });

        interests.forEach(interest => {
          if (selectedPoi.interests && selectedPoi.interests.includes(interest)) {
            scheduledCounts[interest] = (scheduledCounts[interest] || 0) + 1;
          }
        });

        lastPoi = selectedPoi;
      }
    }

    days.push({
      dayNumber: d,
      activities: dayActivities
    });
  }

  // Explanation compilation
  const explanation = [];
  if (groupSize >= 6) {
    explanation.push("تم اختيار معالم ومطاعم ذات مساحات واسعة لتناسب عائلتك الكبيرة.");
  }
  if (isHighHeat) {
    explanation.push("تم تعديل المسار لتفادي ذروة شمس الصيف: استبدال الأنشطة الخارجية ظهراً بزيارات داخلية مكيفة، وتأجيل الفعاليات المفتوحة للفترة المسائية.");
  }
  if (isReduceWalking) {
    explanation.push("تم تقليص الأنشطة ذات المسافات الطويلة واستبدالها بأنشطة ذات وصول قريب ومهيئة لراحتكم.");
  }
  if (isHighTraffic) {
    explanation.push("نظراً للازدحام المروري، قمنا بدمج المعالم جغرافياً لتقليل التنقل المتقاطع وزيادة تقديرات الوصول بنسبة 80%.");
  }
  if (isPrayerBuffer) {
    explanation.push("تم إدراج فترات استراحة تتزامن مع أوقات الصلوات الأربع وتحديد معالم قريبة من المصليات والمساجد الكبرى.");
  }
  if (customSwapId) {
    explanation.push("تم استبعاد المعلم المحدد واقتراح البديل الأفضل الذي يطابق اهتماماتك ومعايير الوصول.");
  }

  // Detect empty days to trigger explanation warning instead of blank timeline
  const hasEmptyDay = days.some(d => d.activities.filter(a => a.isPoi).length === 0);
  let finalExplanation = "";
  
  if (hasEmptyDay) {
    finalExplanation = "لا توجد أنشطة مناسبة كافية ضمن القيود الحالية لمطابقة اهتماماتك ومحددات الحركة والوقت لكامل الأيام.";
  } else if (explanation.length === 0) {
    finalExplanation = "تم توليد خطة الرحلة المخصصة بنجاح بناءً على تفضيلاتك وجدول أوقات الصلاة والوصول.";
  } else {
    finalExplanation = explanation.join(" ");
  }

  return {
    destinationName: cityData.name,
    days,
    decisions,
    explanation: finalExplanation
  };
}
