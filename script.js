/* ------------------------------------------------------------------
   A Special Celebration — countdown, RSVP and guest list
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  /* ---- The celebration ---------------------------------------------
     June 18, 2027 at 4:30 PM (local time).
     Change the numbers below to move the countdown.
     ------------------------------------------------------------------ */
  var YEAR = 2027;
  var MONTH = 6; /* 1 = January, 6 = June */
  var DAY = 18;
  var HOUR = 16; /* 4 PM */
  var MINUTE = 30;

  var TARGET = new Date(YEAR, MONTH - 1, DAY, HOUR, MINUTE, 0, 0);
  var STORAGE_KEY = "special-celebration.me.v1";

  var dayFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
  var timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  var dateLabel = dayFmt.format(TARGET);
  var timeLabel = timeFmt.format(TARGET);

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };

  /* ------------------------------ headline ------------------------- */

  var dayNode = $("#when-day");
  var timeNode = $("#when-time");
  if (dayNode) dayNode.textContent = dateLabel;
  if (timeNode) timeNode.textContent = timeLabel;

  /* ----------------------------- countdown ------------------------- */

  var countdown = $("#countdown");
  var noteNode = $("#countdown-note");
  var units = {};
  Array.prototype.forEach.call(document.querySelectorAll("[data-unit]"), function (node) {
    units[node.dataset.unit] = node;
  });

  var MS_SECOND = 1000;
  var MS_MINUTE = 60 * MS_SECOND;
  var MS_HOUR = 60 * MS_MINUTE;
  var MS_DAY = 24 * MS_HOUR;

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function paint(key, value) {
    var node = units[key];
    if (!node) return;
    var text = pad(value);
    if (node.textContent === text) return;
    node.textContent = text;
    var card = node.closest ? node.closest(".unit") : null;
    if (!card) return;
    card.classList.remove("is-ticking");
    void card.offsetWidth;
    card.classList.add("is-ticking");
  }

  function updateCountdown() {
    var remaining = TARGET.getTime() - Date.now();

    if (remaining <= 0) {
      paint("days", 0);
      paint("hours", 0);
      paint("minutes", 0);
      paint("seconds", 0);
      if (countdown) countdown.classList.add("is-arrived");
      if (noteNode) {
        noteNode.textContent = "The celebration has already taken place";
      }
      return;
    }

    if (countdown) countdown.classList.remove("is-arrived");
    if (noteNode) noteNode.textContent = "Counting down to the big day";

    paint("days", Math.floor(remaining / MS_DAY));
    paint("hours", Math.floor(remaining / MS_HOUR) % 24);
    paint("minutes", Math.floor(remaining / MS_MINUTE) % 60);
    paint("seconds", Math.floor(remaining / MS_SECOND) % 60);
  }

  updateCountdown();
  window.setInterval(updateCountdown, 1000);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) updateCountdown();
  });

  /* ----------------------------- venue map ------------------------- */

  var VENUE = "The Old Barn, 3016 Hoover Rd, Nashville, IN 47448";

  /* Both map services get the same search, so either button works on any
     phone, tablet or computer. */
  var maps = [
    ["#map-google", "https://www.google.com/maps/search/?api=1&query="],
    ["#map-apple", "https://maps.apple.com/?q="]
  ];

  maps.forEach(function (pair) {
    var link = $(pair[0]);
    if (!link) return;
    link.href = pair[1] + encodeURIComponent(VENUE);
    link.setAttribute("aria-label", "Open " + VENUE + " in " + link.textContent.trim());
  });

  /* ---------------------------- guest store ----------------------- */

  function fullName(first, last) {
    return [first, last]
      .filter(function (part) {
        return part && part.trim();
      })
      .join(" ")
      .trim();
  }

  function isText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function normalizeGuest(raw) {
    if (!raw || typeof raw !== "object") return null;

    var first = typeof raw.first === "string" ? raw.first.trim() : "";
    var last = typeof raw.last === "string" ? raw.last.trim() : "";

    /* Replies saved before the form asked for a surname. */
    if (!first && !last && typeof raw.name === "string") {
      var parts = raw.name.trim().split(/\s+/);
      first = parts.shift() || "";
      last = parts.join(" ");
    }

    var name = fullName(first, last);
    if (!name) return null;

    return {
      first: first,
      last: last,
      name: name,
      note: typeof raw.note === "string" ? raw.note.trim() : "",
      stay: Array.isArray(raw.stay) ? raw.stay.filter(isText) : [],
      food: Array.isArray(raw.food) ? raw.food.filter(isText) : [],
      foodNote: typeof raw.foodNote === "string" ? raw.foodNote.trim() : "",
      coming: raw.coming !== false,
      createdAt: raw.createdAt || 0,
      updatedAt: raw.updatedAt || 0
    };
  }

  /* Replies live on the invitation's own server, in data/rsvps.json, so
     every visitor sees the same guest count and the same wishes. */

  var API_URL = "api/rsvps";
  var guestCache = [];

  function readGuests() {
    return guestCache;
  }

  function setGuests(list) {
    guestCache = (Array.isArray(list) ? list : [])
      .map(normalizeGuest)
      .filter(function (guest) {
        return guest !== null;
      });
  }

  function loadGuests() {
    return window
      .fetch(API_URL, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        setGuests(data && data.guests);
        return guestCache;
      });
  }

  function saveGuest(reply) {
    return window
      .fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(reply)
      })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (!response.ok) throw new Error(data.error || "Save failed");
            return data;
          });
      })
      .then(function (data) {
        setGuests(data && data.guests);
      });
  }

  /* Remember this visitor's own reply so "Change my response" can prefill it. */

  function rememberMe(reply) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          first: reply.first,
          last: reply.last,
          note: reply.note,
          coming: reply.coming,
          stay: reply.stay || [],
          food: reply.food || [],
          foodNote: reply.foodNote || ""
        })
      );
    } catch (error) {
      /* private mode — the reply itself is already saved on the server */
    }
  }

  function recallMe() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeGuest(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function initials(name) {
    var parts = name.trim().split(/\s+/).slice(0, 2);
    return parts
      .map(function (part) {
        return part.charAt(0);
      })
      .join("");
  }

  /* ---------------------------- guest list ------------------------ */

  var tallyNumber = $("#tally-number");
  var tallyLabel = $("#tally-label");
  var guestList = $("#guests");
  var emptyNode = $("#guests-empty");

  function renderGuests(popNumber) {
    var guests = readGuests();
    var coming = guests.filter(function (guest) {
      return guest.coming;
    });

    if (tallyNumber) {
      tallyNumber.textContent = String(coming.length);
      if (popNumber) {
        tallyNumber.classList.remove("is-bumping");
        void tallyNumber.offsetWidth;
        tallyNumber.classList.add("is-bumping");
      }
    }
    if (tallyLabel) {
      tallyLabel.textContent = coming.length === 1 ? "guest attending" : "guests attending";
    }

    if (guestList) {
      guestList.innerHTML = "";
      coming
        .slice()
        .sort(function (a, b) {
          return (a.createdAt || 0) - (b.createdAt || 0);
        })
        .forEach(function (guest, index) {
          var item = document.createElement("li");
          item.style.animationDelay = Math.min(index * 45, 360) + "ms";

          var avatar = document.createElement("span");
          avatar.className = "avatar";
          avatar.setAttribute("aria-hidden", "true");
          avatar.textContent = initials(guest.name);

          item.appendChild(avatar);
          item.appendChild(document.createTextNode(guest.name));
          guestList.appendChild(item);
        });
    }

    if (emptyNode) emptyNode.hidden = coming.length > 0;

    renderWishes();
  }

  /* --------------------------- wishes wall ------------------------ */

  var wishesList = $("#wishes");
  var wishesEmpty = $("#wishes-empty");

  function renderWishes() {
    if (!wishesList) return;

    var written = readGuests()
      .filter(function (guest) {
        return guest.note;
      })
      .sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

    wishesList.innerHTML = "";

    written.forEach(function (guest, index) {
      var item = document.createElement("li");
      item.className = "wish";
      item.style.animationDelay = Math.min(index * 55, 440) + "ms";

      var text = document.createElement("p");
      text.className = "wish__text";
      text.textContent = guest.note;

      var who = document.createElement("p");
      who.className = "wish__who";

      var badge = document.createElement("span");
      badge.className = "wish__avatar";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = initials(guest.name);

      var byline = document.createElement("span");
      byline.className = "wish__name";
      byline.textContent = guest.name;

      who.appendChild(badge);
      who.appendChild(byline);

      item.appendChild(text);
      item.appendChild(who);
      wishesList.appendChild(item);
    });

    if (wishesEmpty) wishesEmpty.hidden = written.length > 0;

    /* With no stories left to show, the wall would only be a blank section. */
    var section = wishesList.closest ? wishesList.closest(".wishes") : null;
    if (section) section.hidden = written.length === 0;
  }

  /* ------------------------------ confetti ------------------------ */

  var canvas = $("#confetti");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pieces = [];
  var frame = null;
  var dpr = 1;

  function sizeCanvas() {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawConfetti() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (var i = pieces.length - 1; i >= 0; i--) {
      var piece = pieces[i];
      piece.vy += 0.17;
      piece.vx *= 0.988;
      piece.vy *= 0.995;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.spin;
      piece.life -= 0.0075;

      if (piece.life <= 0 || piece.y > window.innerHeight + 60) {
        pieces.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, piece.life));
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
      ctx.restore();
    }

    if (pieces.length) {
      frame = window.requestAnimationFrame(drawConfetti);
    } else {
      frame = null;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function celebrate(x, y) {
    if (!ctx || reduceMotion) return;
    var colors = ["#f4e2b7", "#e9cd93", "#c79a52", "#f7f2e8", "#d8a3ae", "#7fb0ad"];

    for (var i = 0; i < 110; i++) {
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      var speed = 5 + Math.random() * 11;
      pieces.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed * (0.55 + Math.random() * 0.8),
        vy: Math.sin(angle) * speed,
        width: 3 + Math.random() * 5,
        height: 5 + Math.random() * 9,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.34,
        color: colors[i % colors.length],
        life: 1
      });
    }

    if (!frame) frame = window.requestAnimationFrame(drawConfetti);
  }

  if (canvas && ctx) {
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
  }

  /* -------------------------------- RSVP -------------------------- */

  var form = $("#rsvp-form");
  var firstNameInput = $("#guest-first");
  var lastNameInput = $("#guest-last");
  var stayInputs = Array.prototype.slice.call(document.querySelectorAll('input[name="stay"]'));
  var foodInputs = Array.prototype.slice.call(document.querySelectorAll('input[name="food"]'));
  var foodNoteInput = $("#food-note");
  var formNote = $("#form-note");
  var submitBtn = $("#rsvp-submit");
  var thanks = $("#thanks");
  var thanksLine = $("#thanks-line");
  var editBtn = $("#edit-rsvp");

  function checkedValues(boxes) {
    return boxes
      .filter(function (box) {
        return box.checked;
      })
      .map(function (box) {
        return box.value;
      });
  }

  function tickBoxes(boxes, chosen) {
    boxes.forEach(function (box) {
      box.checked = (chosen || []).indexOf(box.value) !== -1;
    });
  }

  function showForm(guest, prefillReply) {
    if (!form || !thanks) return;
    thanks.hidden = true;
    form.hidden = false;
    if (guest) {
      if (firstNameInput) firstNameInput.value = guest.first || "";
      if (lastNameInput) lastNameInput.value = guest.last || "";
      tickBoxes(stayInputs, guest.stay);
      tickBoxes(foodInputs, guest.food);
      if (foodNoteInput) foodNoteInput.value = guest.foodNote || "";
    }
    if (prefillReply && form) {
      var radio = form.querySelector('input[name="reply"][value="' + prefillReply + '"]');
      if (radio) radio.checked = true;
    }
    if (formNote) formNote.textContent = "";
    if (firstNameInput) firstNameInput.focus();
  }

  function showThanks(name, coming) {
    if (!form || !thanks) return;
    form.hidden = true;
    thanks.hidden = false;
    if (thanksLine) {
      thanksLine.textContent = coming
        ? "Thank you, " + name + ". You are on the guest list for " + dateLabel + "."
        : "Thank you, " + name + ". We are sorry you cannot make it, and we will miss you.";
    }
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var first = (firstNameInput ? firstNameInput.value : "").replace(/\s+/g, " ").trim();
      var last = (lastNameInput ? lastNameInput.value : "").replace(/\s+/g, " ").trim();
      var foodNote = (foodNoteInput ? foodNoteInput.value : "").replace(/\s+/g, " ").trim();
      var stay = checkedValues(stayInputs);
      var food = checkedValues(foodInputs);

      if (!first) {
        if (formNote) formNote.textContent = "Please add your first name so we know who to expect.";
        if (firstNameInput) firstNameInput.focus();
        return;
      }

      if (!last) {
        if (formNote) formNote.textContent = "Please add your last name too.";
        if (lastNameInput) lastNameInput.focus();
        return;
      }

      var name = fullName(first, last);
      var replyNode = form.querySelector('input[name="reply"]:checked');
      var coming = !replyNode || replyNode.value !== "no";

      if (formNote) formNote.textContent = "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("is-saving");
      }

      var reply = {
        first: first,
        last: last,
        coming: coming,
        stay: stay,
        food: food,
        foodNote: foodNote
      };

      saveGuest(reply)
        .then(function () {
          rememberMe(reply);
          renderGuests(true);

          if (coming && submitBtn) {
            var box = submitBtn.getBoundingClientRect();
            celebrate(box.left + box.width / 2, Math.max(box.top, window.innerHeight * 0.35));
          }

          showThanks(name, coming);
        })
        .catch(function () {
          if (formNote) {
            formNote.textContent =
              "We could not save your reply just now. Please check your connection and try again.";
          }
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove("is-saving");
          }
        });
    });
  }

  if (editBtn) {
    editBtn.addEventListener("click", function () {
      var mine = recallMe();
      showForm(mine, mine && mine.coming === false ? "no" : "yes");
    });
  }

  /* ----------------------------- gallery -------------------------- */

  var slidesRoot = $("#slides");
  if (slidesRoot) {
    var track = $("#slides-track");
    var PHOTOS = [];

    for (var photoIndex = 1; photoIndex <= 41; photoIndex++) {
      PHOTOS.push("assets/slides/photo-" + (photoIndex < 10 ? "0" : "") + photoIndex + ".jpg");
    }

    if (track) {
      PHOTOS.forEach(function (src, index) {
        var slide = document.createElement("div");
        slide.className = "slide slide--photo";

        var backdrop = document.createElement("span");
        backdrop.className = "slide__blur";
        backdrop.style.backgroundImage = "url('" + src + "')";
        backdrop.setAttribute("aria-hidden", "true");

        var image = document.createElement("img");
        image.src = src;
        image.alt = "Photograph " + (index + 1) + " of " + PHOTOS.length;
        image.loading = index === 0 ? "eager" : "lazy";
        image.decoding = "async";

        slide.appendChild(backdrop);
        slide.appendChild(image);
        track.appendChild(slide);
      });
    }

    var slideItems = track ? Array.prototype.slice.call(track.children) : [];
    var prevBtn = $("#slides-prev");
    var nextBtn = $("#slides-next");
    var dotsBox = $("#slides-dots");
    var currentSlide = 0;
    var slideTimer = null;
    var SLIDE_DELAY = 5500;
    var     dots = [];

    if (dotsBox && slideItems.length > 12) {
      dotsBox.classList.add("slides__dots--many");
    }

    slideItems.forEach(function (slide, index) {
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", index + 1 + " of " + slideItems.length);

      if (!dotsBox) return;
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "slides__dot";
      dot.setAttribute("aria-label", "Show photo " + (index + 1));
      dot.addEventListener("click", function () {
        showSlide(index);
        restartSlides();
      });
      dotsBox.appendChild(dot);
      dots.push(dot);
    });

    function showSlide(index) {
      if (!track || !slideItems.length) return;
      currentSlide = (index + slideItems.length) % slideItems.length;
      track.style.transform = "translateX(" + -currentSlide * 100 + "%)";

      slideItems.forEach(function (slide, i) {
        var active = i === currentSlide;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", active ? "false" : "true");
      });

      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === currentSlide);
        if (i === currentSlide) {
          dot.setAttribute("aria-current", "true");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
    }

    function stopSlides() {
      if (slideTimer) {
        window.clearInterval(slideTimer);
        slideTimer = null;
      }
    }

    function startSlides() {
      stopSlides();
      if (reduceMotion || slideItems.length < 2 || document.hidden) return;
      slideTimer = window.setInterval(function () {
        showSlide(currentSlide + 1);
      }, SLIDE_DELAY);
    }

    function restartSlides() {
      startSlides();
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        showSlide(currentSlide + 1);
        restartSlides();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        showSlide(currentSlide - 1);
        restartSlides();
      });
    }

    slidesRoot.addEventListener("mouseenter", stopSlides);
    slidesRoot.addEventListener("mouseleave", startSlides);
    slidesRoot.addEventListener("focusin", stopSlides);
    slidesRoot.addEventListener("focusout", startSlides);

    slidesRoot.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        showSlide(currentSlide + 1);
        restartSlides();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        showSlide(currentSlide - 1);
        restartSlides();
      }
    });

    var swipeStart = null;
    slidesRoot.addEventListener("pointerdown", function (event) {
      swipeStart = event.clientX;
    });
    slidesRoot.addEventListener("pointerup", function (event) {
      if (swipeStart === null) return;
      var delta = event.clientX - swipeStart;
      swipeStart = null;
      if (Math.abs(delta) < 45) return;
      showSlide(currentSlide + (delta < 0 ? 1 : -1));
      restartSlides();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopSlides();
      } else {
        startSlides();
      }
    });

    showSlide(0);
    startSlides();
  }

  /* ------------------------------ reveal -------------------------- */

  var revealNodes = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  revealNodes.forEach(function (node, index) {
    node.style.transitionDelay = Math.min(index * 90, 480) + "ms";
  });

  function show(node) {
    node.classList.add("is-visible");
  }

  /* Whatever is already on screen is shown straight away, so the invitation
     never depends on an observer callback arriving. */
  function showOnScreen() {
    var limit = window.innerHeight * 0.96;
    revealNodes.forEach(function (node) {
      if (node.classList.contains("is-visible")) return;
      var rect = node.getBoundingClientRect();
      if (rect.top < limit && rect.bottom > 0) show(node);
    });
  }

  var observerFired = false;

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        observerFired = true;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          show(entry.target);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );
    revealNodes.forEach(function (node) {
      observer.observe(node);
    });

    /* If the observer never reports (hidden tab, embedded view), reveal the
       rest rather than leaving the page blank. */
    window.setTimeout(function () {
      if (!observerFired) {
        revealNodes.forEach(show);
      } else {
        showOnScreen();
      }
    }, 1500);
  } else {
    revealNodes.forEach(show);
  }

  showOnScreen();

  /* ------------------------------ start --------------------------- */

  loadGuests()
    .then(function () {
      renderGuests(false);
    })
    .catch(function () {
      if (emptyNode) {
        emptyNode.hidden = false;
        emptyNode.textContent = "Replies could not be loaded right now — please refresh in a moment.";
      }
      if (wishesEmpty) {
        wishesEmpty.hidden = false;
        wishesEmpty.textContent = "Wishes could not be loaded right now — please refresh in a moment.";
      }
    });
})();
