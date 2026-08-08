import { generateItinerary, generateItineraryAsync } from "./services/planner.js";

/* ==========================================================================
   Application State
   ========================================================================== */
const state = {
  preferences: {
    destination: "riyadh",
    groupSize: 2,
    duration: 1,
    interests: ["التاريخ", "الطبيعة", "الثقافة"],
    mobility: "normal",
    maxWalking: 1000,
    startTime: "09:00",
    availableHours: 8
  },
  modifiers: {
    highHeat: false,
    reduceWalking: false,
    highTraffic: false,
    prayerBuffer: false,
    swapPoiId: null,
    forceReplan: false
  },
  activeDay: 1,
  currentItinerary: null
};

/* ==========================================================================
   DOM Cache
   ========================================================================== */
const dom = {};

function cacheDOMElements() {
  // Screens
  dom.setupScreen = document.getElementById("setup-screen");
  dom.itineraryScreen = document.getElementById("itinerary-screen");
  dom.loadingOverlay = document.getElementById("loading-overlay");
  dom.loadingTitle = document.getElementById("loading-title");

  // Counters
  dom.btnDecTravelers = document.getElementById("btn-dec-travelers");
  dom.btnIncTravelers = document.getElementById("btn-inc-travelers");
  dom.travelersInput = document.getElementById("travelers-input");
  dom.btnDecDuration = document.getElementById("btn-dec-duration");
  dom.btnIncDuration = document.getElementById("btn-inc-duration");
  dom.durationInput = document.getElementById("duration-input");

  // Cards & Selectors
  dom.destCards = document.querySelectorAll(".dest-card");
  dom.interestChips = document.querySelectorAll(".interest-chip");
  dom.mobilityCards = document.querySelectorAll(".mobility-card");
  dom.walkingSelect = document.getElementById("walking-select");
  dom.availableHoursSelect = document.getElementById("available-hours-select");

  // Time Selects
  dom.startTimeHour = document.getElementById("starttime-hour");
  dom.startTimeMinute = document.getElementById("starttime-minute");
  dom.startTimeAmPm = document.getElementById("starttime-ampm");

  // Triggers
  dom.btnGenerate = document.getElementById("btn-generate");
  dom.btnEditSetup = document.getElementById("btn-edit-setup");

  // Itinerary View Elements
  dom.cityHeroImg = document.getElementById("city-hero-img");
  dom.cityTitle = document.getElementById("itinerary-city-title");
  dom.cityDesc = document.getElementById("itinerary-city-desc");
  dom.decisionsList = document.getElementById("decisions-list");
  dom.explanationBanner = document.getElementById("explanation-banner");
  dom.explanationText = document.getElementById("explanation-text");
  dom.dayTabsContainer = document.getElementById("day-tabs-container");
  dom.activitiesTimeline = document.getElementById("activities-timeline");

  // Replanning Controls
  dom.replanHeat = document.getElementById("replan-heat");
  dom.replanWalking = document.getElementById("replan-walking");
  dom.replanTraffic = document.getElementById("replan-traffic");
  dom.replanPrayer = document.getElementById("replan-prayer");
  dom.replanReset = document.getElementById("replan-reset");
}

/* ==========================================================================
   Initialization
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  cacheDOMElements();
  setupFormBindings();
  setupReplanningBindings();
});

/* ==========================================================================
   Setup Screen Event Bindings
   ========================================================================== */
function setupFormBindings() {
  // Travelers counter
  if (dom.btnDecTravelers && dom.travelersInput) {
    dom.btnDecTravelers.addEventListener("click", () => {
      let val = parseInt(dom.travelersInput.value, 10) || 1;
      if (val > 1) {
        val--;
        dom.travelersInput.value = val;
        state.preferences.groupSize = val;
      }
    });
  }

  if (dom.btnIncTravelers && dom.travelersInput) {
    dom.btnIncTravelers.addEventListener("click", () => {
      let val = parseInt(dom.travelersInput.value, 10) || 1;
      if (val < 20) {
        val++;
        dom.travelersInput.value = val;
        state.preferences.groupSize = val;
      }
    });
  }

  // Duration counter
  if (dom.btnDecDuration && dom.durationInput) {
    dom.btnDecDuration.addEventListener("click", () => {
      let val = parseInt(dom.durationInput.value, 10) || 1;
      if (val > 1) {
        val--;
        dom.durationInput.value = val;
        state.preferences.duration = val;
      }
    });
  }

  if (dom.btnIncDuration && dom.durationInput) {
    dom.btnIncDuration.addEventListener("click", () => {
      let val = parseInt(dom.durationInput.value, 10) || 1;
      if (val < 3) {
        val++;
        dom.durationInput.value = val;
        state.preferences.duration = val;
      }
    });
  }

  // Destination Cards
  if (dom.destCards) {
    dom.destCards.forEach(card => {
      card.addEventListener("click", () => {
        dom.destCards.forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        state.preferences.destination = card.dataset.dest;
      });
    });
  }

  // Interest Chips
  if (dom.interestChips) {
    dom.interestChips.forEach(chip => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("selected");
        const value = chip.dataset.value;
        const index = state.preferences.interests.indexOf(value);
        if (index > -1) {
          state.preferences.interests.splice(index, 1);
        } else {
          state.preferences.interests.push(value);
        }
      });
    });
  }

  // Mobility Cards
  if (dom.mobilityCards) {
    dom.mobilityCards.forEach(card => {
      card.addEventListener("click", () => {
        dom.mobilityCards.forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        state.preferences.mobility = card.dataset.mobility;
        
        // Accessibility preset modifiers
        if (card.dataset.mobility === "wheelchair") {
          if (dom.walkingSelect) dom.walkingSelect.value = "500";
          state.preferences.maxWalking = 500;
        } else if (card.dataset.mobility === "elderly") {
          if (dom.walkingSelect) dom.walkingSelect.value = "1000";
          state.preferences.maxWalking = 1000;
        }
      });
    });
  }

  // Select selects
  if (dom.walkingSelect) {
    dom.walkingSelect.addEventListener("change", (e) => {
      state.preferences.maxWalking = parseInt(e.target.value, 10);
    });
  }

  if (dom.availableHoursSelect) {
    dom.availableHoursSelect.addEventListener("change", (e) => {
      state.preferences.availableHours = parseInt(e.target.value, 10);
    });
  }

  // Start Time Selects
  const syncStartTime = () => {
    state.preferences.startTime = get24HourTime();
  };

  if (dom.startTimeHour) dom.startTimeHour.addEventListener("change", syncStartTime);
  if (dom.startTimeMinute) dom.startTimeMinute.addEventListener("change", syncStartTime);
  if (dom.startTimeAmPm) dom.startTimeAmPm.addEventListener("change", syncStartTime);

  // Hook generator button
  if (dom.btnGenerate) {
    dom.btnGenerate.addEventListener("click", () => {
      executePlanningFlow();
    });
  }

  // Hook back button
  if (dom.btnEditSetup) {
    dom.btnEditSetup.addEventListener("click", () => {
      if (dom.itineraryScreen) dom.itineraryScreen.classList.add("hidden");
      if (dom.setupScreen) {
        dom.setupScreen.classList.remove("hidden");
        dom.setupScreen.classList.add("fade-in");
      }
    });
  }
}

/* ==========================================================================
   Replanning Controls Bindings
   ========================================================================== */
function setupReplanningBindings() {
  const toggleModifier = (key, btnEl, loadingMsg) => {
    if (!btnEl) return;
    state.modifiers[key] = !state.modifiers[key];
    btnEl.classList.toggle("active", state.modifiers[key]);
    triggerReplan(loadingMsg);
  };

  if (dom.replanHeat) {
    dom.replanHeat.addEventListener("click", () => toggleModifier("highHeat", dom.replanHeat, "رِحال يعيد الجدولة لتجنب أشعة الشمس والحرارة..."));
  }
  if (dom.replanWalking) {
    dom.replanWalking.addEventListener("click", () => toggleModifier("reduceWalking", dom.replanWalking, "رِحال يختصر مسافات المشي ويقرب معالم الوصول..."));
  }
  if (dom.replanTraffic) {
    dom.replanTraffic.addEventListener("click", () => toggleModifier("highTraffic", dom.replanTraffic, "رِحال يحلل الازدحام المروري ويعيد تنظيم مسار الحركة..."));
  }
  if (dom.replanPrayer) {
    dom.replanPrayer.addEventListener("click", () => toggleModifier("prayerBuffer", dom.replanPrayer, "رِحال يضيف فترات للراحة والصلوات بالقرب من المساجد..."));
  }
  if (dom.replanReset) {
    dom.replanReset.addEventListener("click", () => {
      Object.keys(state.modifiers).forEach(k => state.modifiers[k] = false);
      state.modifiers.forceReplan = true;
      [dom.replanHeat, dom.replanWalking, dom.replanTraffic, dom.replanPrayer].forEach(b => {
        if (b) b.classList.remove("active");
      });
      triggerReplan("رِحال يعيد تحسين رحلتك بالكامل حسب تفضيلاتك...");
    });
  }
}

/* ==========================================================================
   Execution Flows (Planning / Replanning)
   ========================================================================== */
function executePlanningFlow() {
  state.activeDay = 1;
  state.preferences.startTime = get24HourTime();
  
  if (dom.availableHoursSelect) {
    state.preferences.availableHours = parseInt(dom.availableHoursSelect.value, 10) || 8;
  }
  if (dom.walkingSelect) {
    state.preferences.maxWalking = parseInt(dom.walkingSelect.value, 10) || 1000;
  }

  // Reset modifiers
  Object.keys(state.modifiers).forEach(k => state.modifiers[k] = false);
  [dom.replanHeat, dom.replanWalking, dom.replanTraffic, dom.replanPrayer].forEach(b => {
    if (b) b.classList.remove("active");
  });

  // Show loading indicator
  if (dom.loadingTitle) dom.loadingTitle.textContent = "رِحال ينسق رحلتك السياحية المثالية بالذكاء الاصطناعي...";
  if (dom.loadingOverlay) dom.loadingOverlay.classList.remove("hidden");

  setTimeout(async () => {
    state.currentItinerary = await generateItineraryAsync(state.preferences, state.modifiers);
    
    if (dom.loadingOverlay) dom.loadingOverlay.classList.add("hidden");

    renderItineraryView();

    if (dom.setupScreen) dom.setupScreen.classList.add("hidden");
    if (dom.itineraryScreen) {
      dom.itineraryScreen.classList.remove("hidden");
      dom.itineraryScreen.classList.add("fade-in");
    }
  }, 500);
}

function triggerReplan(loadingMsg) {
  if (dom.loadingTitle) dom.loadingTitle.textContent = loadingMsg || "رِحال يعيد صياغة خطة رحلتك...";
  if (dom.loadingOverlay) dom.loadingOverlay.classList.remove("hidden");

  if (dom.activitiesTimeline) dom.activitiesTimeline.classList.add("hidden");

  setTimeout(async () => {
    state.currentItinerary = await generateItineraryAsync(state.preferences, state.modifiers, state.currentItinerary);
    
    if (dom.loadingOverlay) dom.loadingOverlay.classList.add("hidden");
    
    renderItineraryView();
    
    if (dom.activitiesTimeline) {
      dom.activitiesTimeline.classList.remove("hidden");
      dom.activitiesTimeline.classList.add("fade-in");
    }
  }, 500);
}

/* ==========================================================================
   Itinerary Rendering Functions
   ========================================================================== */
function renderItineraryView() {
  const itin = state.currentItinerary;
  if (!itin || itin.error) {
    alert("عذراً، حدث خطأ أثناء توليد خطة الرحلة.");
    return;
  }

  let heroUrl = "/src/assets/riyadh.jpg";
  let cityDescription = "";
  if (state.preferences.destination === "alula") {
    heroUrl = "/src/assets/alula.jpg";
    cityDescription = "أعجوبة التاريخ والآثار الطبيعية";
  } else if (state.preferences.destination === "jeddah") {
    heroUrl = "/src/assets/jeddah.jpg";
    cityDescription = "عروس البحر الأحمر وبوابة مكة التاريخية";
  } else {
    cityDescription = "العاصمة السعودية النابضة والحديثة";
  }
  
  if (dom.cityHeroImg) {
    dom.cityHeroImg.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0.3) 20%, rgba(10, 19, 15, 0.95) 95%), url('${heroUrl}')`;
  }
  if (dom.cityTitle) dom.cityTitle.textContent = itin.destinationName;
  if (dom.cityDesc) dom.cityDesc.textContent = cityDescription;

  renderItineraryMainContent();
}

function renderItineraryMainContent() {
  const itin = state.currentItinerary;
  if (!itin) return;

  // 1. Decisions list
  if (dom.decisionsList) {
    dom.decisionsList.innerHTML = "";
    if (itin.decisions) {
      itin.decisions.forEach(decision => {
        const li = document.createElement("li");
        li.textContent = decision;
        dom.decisionsList.appendChild(li);
      });
    }
  }

  // 2. Explanation banner
  if (dom.explanationBanner && dom.explanationText) {
    if (itin.explanation) {
      dom.explanationText.textContent = itin.explanation;
      dom.explanationBanner.classList.remove("hidden");
    } else {
      dom.explanationBanner.classList.add("hidden");
    }
  }

  // 3. Day tabs
  if (dom.dayTabsContainer) {
    dom.dayTabsContainer.innerHTML = "";
    if (state.preferences.duration > 1) {
      dom.dayTabsContainer.classList.remove("hidden");
      for (let d = 1; d <= state.preferences.duration; d++) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = `day-tab ${state.activeDay === d ? "active" : ""}`;
        tab.textContent = `اليوم ${d}`;
        tab.addEventListener("click", () => {
          state.activeDay = d;
          document.querySelectorAll(".day-tab").forEach((t, idx) => {
            t.classList.toggle("active", idx + 1 === d);
          });
          renderTimelineList();
        });
        dom.dayTabsContainer.appendChild(tab);
      }
    } else {
      dom.dayTabsContainer.classList.add("hidden");
    }
  }

  // 4. Render the timeline items
  renderTimelineList();
}

function renderTimelineList() {
  const itin = state.currentItinerary;
  if (!itin || !dom.activitiesTimeline) return;

  dom.activitiesTimeline.innerHTML = "";

  const dayData = itin.days ? itin.days.find(d => d.dayNumber === state.activeDay) : null;
  if (!dayData || !dayData.activities || dayData.activities.length === 0) {
    dom.activitiesTimeline.innerHTML = `<div class="no-activities">لا توجد أنشطة مجدولة لهذا اليوم. حاول توسيع دائرة اهتماماتك أو زيادة المشي المسموح.</div>`;
    return;
  }

  dayData.activities.forEach(act => {
    if (act.isTransit) {
      const transitDiv = document.createElement("div");
      transitDiv.className = "transit-item";
      transitDiv.innerHTML = `
        <div class="transit-marker"></div>
        <div class="transit-card">
          <i class="fa-solid fa-car-side"></i>
          <span>${act.typeText} - يستغرق حوالي <strong>${act.durationText}</strong></span>
        </div>
      `;
      dom.activitiesTimeline.appendChild(transitDiv);
    } else if (act.isPrayerSlot) {
      const prayerDiv = document.createElement("div");
      prayerDiv.className = "prayer-item";
      prayerDiv.innerHTML = `
        <div class="prayer-marker">🕌</div>
        <div class="prayer-card">
          <div class="prayer-card-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
          <div class="prayer-card-content">
            <h4 class="prayer-card-title">${act.name}</h4>
            <p class="prayer-card-desc">${act.details}</p>
          </div>
          <div class="prayer-card-time">${act.startTime} - ${act.endTime}</div>
        </div>
      `;
      dom.activitiesTimeline.appendChild(prayerDiv);
    } else if (act.isPoi) {
      const poiDiv = document.createElement("div");
      poiDiv.className = "timeline-item";

      let alertsHtml = "";
      if (act.accessibilityAlerts && act.accessibilityAlerts.length > 0) {
        alertsHtml = `<div class="card-alerts">` + 
          act.accessibilityAlerts.map(alertText => {
            const isDanger = alertText.includes("تنبيه") || alertText.includes("خطر");
            return `<div class="card-alert-item ${isDanger ? 'alert-danger' : ''}">
              <i class="fa-solid ${isDanger ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
              <span>${alertText}</span>
            </div>`;
          }).join("") + `</div>`;
      }

      const categoryIcon = getCategoryIcon(act.category);

      poiDiv.innerHTML = `
        <div class="timeline-marker"></div>
        <div class="activity-card">
          <div class="activity-header">
            <div class="activity-title-group">
              <h3 class="activity-title">
                <i class="${categoryIcon} text-gold"></i>
                <span>${act.name}</span>
              </h3>
              <div class="activity-badges">
                <span class="act-badge badge-interest">${act.category}</span>
                <span class="act-badge">${act.type === "indoor" ? "مغلق ومكيف" : act.type === "mixed" ? "مزدوج" : "مفتوح في الهواء الطلق"}</span>
              </div>
            </div>
            <div class="time-slot">
              <i class="fa-solid fa-clock"></i>
              <span>${act.startTime} - ${act.endTime}</span>
            </div>
          </div>

          <p class="activity-description">${act.description}</p>
          
          <div class="why-selected-box">
            <div class="why-title">قرار رِحال الذكي</div>
            <div class="why-body">${act.whySelected}</div>
          </div>

          ${alertsHtml}

          <div class="activity-metadata">
            <div class="meta-item">
              <i class="fa-solid fa-stopwatch"></i>
              <span>المدة المقترحة: <strong>${act.duration}</strong></span>
            </div>
            <div class="meta-item">
              <i class="fa-solid fa-person-walking"></i>
              <span>المشي المطلوب: <strong>${act.walkingDistance} (${act.walkingLevelText})</strong></span>
            </div>
            <button type="button" class="btn-swap-poi" data-id="${act.poiId}">
              <i class="fa-solid fa-arrows-rotate"></i>
              <span>استبدل هذا المعلم</span>
            </button>
          </div>
        </div>
      `;

      const swapBtn = poiDiv.querySelector(".btn-swap-poi");
      if (swapBtn) {
        swapBtn.addEventListener("click", () => {
          const poiId = swapBtn.dataset.id;
          state.modifiers.swapPoiId = poiId;
          triggerReplan("رِحال يقترح معلماً بديلاً مناسباً للتفضيلات...");
        });
      }

      dom.activitiesTimeline.appendChild(poiDiv);
    }
  });
}

function getCategoryIcon(category) {
  switch (category) {
    case "التاريخ": return "fa-solid fa-landmark";
    case "الطبيعة": return "fa-solid fa-mountain-sun";
    case "التصوير": return "fa-solid fa-camera-retro";
    case "الطعام": return "fa-solid fa-utensils";
    case "الثقافة": return "fa-solid fa-mosque";
    default: return "fa-solid fa-compass";
  }
}

function get24HourTime() {
  if (!dom.startTimeHour || !dom.startTimeMinute || !dom.startTimeAmPm) return "09:00";
  const hour = dom.startTimeHour.value;
  const minute = dom.startTimeMinute.value;
  const ampm = dom.startTimeAmPm.value;
  let h = parseInt(hour, 10);
  if (ampm === "PM" && h < 12) {
    h += 12;
  } else if (ampm === "AM" && h === 12) {
    h = 0;
  }
  return `${String(h).padStart(2, "0")}:${minute}`;
}
