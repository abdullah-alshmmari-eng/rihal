import { generateItinerary, parseTime } from "./planner.js";

// Custom Assertion Helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

export function runAllTests() {
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, passed: true, error: null });
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
    }
  }

  // 1. 1-day trip Test
  test("سيناريو 1: رحلة ليوم واحد (Riyadh, 1 Day, Morning Start)", () => {
    const preferences = {
      destination: "riyadh",
      groupSize: 2,
      duration: 1,
      interests: ["التاريخ", "الطبيعة"],
      mobility: "normal",
      maxWalking: 2000,
      startTime: "09:00",
      availableHours: 8
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ في توليد خطة الرحلة: ${itin.error}`);
    assert(itin.days.length === 1, `يجب أن تحتوي الرحلة على يوم واحد فقط، ولكنها تحتوي على ${itin.days.length}`);
    
    const day1Pois = itin.days[0].activities.filter(a => a.isPoi);
    assert(day1Pois.length > 0, "اليوم الأول لا يحتوي على أي معالم سياحية");
    
    // Check that it starts exactly at 09:00
    assert(day1Pois[0].startTime === "09:00", `يجب أن يبدأ أول نشاط الساعة 09:00، ولكنه بدأ الساعة ${day1Pois[0].startTime}`);
  });

  // 2. 2-day trip Test
  test("سيناريو 2: رحلة ليومين (AlUla, 2 Days, Morning Start)", () => {
    const preferences = {
      destination: "alula",
      groupSize: 2,
      duration: 2,
      interests: ["التاريخ", "الطبيعة", "التصوير"],
      mobility: "normal",
      maxWalking: 2000,
      startTime: "09:00",
      availableHours: 8
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ: ${itin.error}`);
    assert(itin.days.length === 2, `يجب أن تكون مدة الرحلة يومين، وجدنا ${itin.days.length}`);
    
    const day1Pois = itin.days[0].activities.filter(a => a.isPoi);
    const day2Pois = itin.days[1].activities.filter(a => a.isPoi);
    
    assert(day1Pois.length > 0, "اليوم الأول فارغ");
    assert(day2Pois.length > 0, "اليوم الثاني فارغ");
    
    // Check for attraction duplication across days
    const scheduledIds = new Set();
    itin.days.forEach(day => {
      day.activities.forEach(act => {
        if (act.isPoi) {
          assert(!scheduledIds.has(act.poiId), `المعلم المكرر: ${act.name} تم جدولته أكثر من مرة.`);
          scheduledIds.add(act.poiId);
        }
      });
    });
  });

  // 3. 3-day trip Test
  test("سيناريو 3: رحلة لـ 3 أيام وتوزيع المعالم بالتساوي (Riyadh, 3 Days, Balanced)", () => {
    const preferences = {
      destination: "riyadh",
      groupSize: 2,
      duration: 3,
      interests: ["التاريخ", "الطبيعة", "الثقافة", "التصوير"],
      mobility: "normal",
      maxWalking: 2000,
      startTime: "09:00",
      availableHours: 8
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ: ${itin.error}`);
    assert(itin.days.length === 3, `المدة يجب أن تكون 3 أيام، وجدنا ${itin.days.length}`);
    
    const day1Pois = itin.days[0].activities.filter(a => a.isPoi);
    const day2Pois = itin.days[1].activities.filter(a => a.isPoi);
    const day3Pois = itin.days[2].activities.filter(a => a.isPoi);

    // CRITICAL: Day 3 must NOT be empty!
    assert(day1Pois.length > 0, "اليوم الأول فارغ");
    assert(day2Pois.length > 0, "اليوم الثاني فارغ");
    assert(day3Pois.length > 0, "اليوم الثالث فارغ (تم إصلاح الخلل بنجاح!)");
  });

  // 4. 3-day trip with limited mobility Test
  test("سيناريو 4: رحلة لـ 3 أيام لذوي الهمم (Jeddah, Wheelchair Accessible)", () => {
    const preferences = {
      destination: "jeddah",
      groupSize: 2,
      duration: 3,
      interests: ["التاريخ", "الطبيعة", "التصوير", "الطعام"],
      mobility: "wheelchair",
      maxWalking: 500, // tight limit
      startTime: "09:00",
      availableHours: 8
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ: ${itin.error}`);
    
    // Check that every scheduled POI is wheelchair friendly
    itin.days.forEach(day => {
      day.activities.forEach(act => {
        if (act.isPoi) {
          assert(act.wheelchairFriendly === true, `المعلم ${act.name} غير مهيأ للكراسي المتحركة ولكنه جُدول في رحلة ذوي الهمم`);
        }
      });
    });
  });

  // 5. 3-day trip with 4:00 PM start time Test
  test("سيناريو 5: رحلة لـ 3 أيام ببدء متأخر (Riyadh, Start 4:00 PM, Limit 6 hours)", () => {
    const preferences = {
      destination: "riyadh",
      groupSize: 2,
      duration: 3,
      interests: ["التاريخ", "الطبيعة", "الثقافة"],
      mobility: "normal",
      maxWalking: 2000,
      startTime: "16:00", // 4:00 PM
      availableHours: 6 // 6 hours limit -> must end by 10:00 PM (22:00)
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ: ${itin.error}`);
    
    itin.days.forEach((day, index) => {
      const dayPois = day.activities.filter(a => a.isPoi);
      
      // Every day must have at least one activity if possible
      assert(dayPois.length > 0, `اليوم ${index + 1} لا يحتوي على معالم بالرغم من البدء المتأخر`);
      
      // Check start time constraints
      assert(dayPois[0].startTime === "16:00", `اليوم ${index + 1} يجب أن يبدأ أول معلم فيه الساعة 16:00، ولكنه بدأ الساعة ${dayPois[0].startTime}`);
      
      // Check available hours constraints
      dayPois.forEach(poi => {
        const endHours = parseTime(poi.endTime);
        assert(endHours <= 22.0, `المعلم ${poi.name} ينتهي في الساعة ${poi.endTime} وهو ما يتعدى الحد الأقصى للجولة اليومية (10:00 مساءً)`);
      });
    });
  });

  // 6. AlUla 3 Days, Start 4:00 PM, Limited Mobility, Minimal walking Test (User Requested Scenario)
  test("سيناريو 6: AlUla 3 Days, Start 4:00 PM, Limited Mobility, Minimal walking", () => {
    const preferences = {
      destination: "alula",
      groupSize: 2,
      duration: 3,
      interests: ["التاريخ", "الطبيعة", "التصوير"],
      mobility: "wheelchair",
      maxWalking: 500,
      startTime: "16:00",
      availableHours: 8
    };

    const itin = generateItinerary(preferences);

    assert(!itin.error, `خطأ: ${itin.error}`);
    assert(itin.days.length === 3, `المدة يجب أن تكون 3 أيام، وجدنا ${itin.days.length}`);
    
    itin.days.forEach((day, index) => {
      const dayPois = day.activities.filter(a => a.isPoi);
      assert(dayPois.length >= 2, `اليوم ${index + 1} يجب أن يحتوي على أكثر من نشاط واحد (أنشطة متعددة)، ولكنه يحتوي على ${dayPois.length}`);
    });
  });

  return results;
}
