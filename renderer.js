// renderer.js
//
// Runs in the sandboxed, isolated renderer. No Node access — only the
// tiny `window.api` surface exposed by preload.js. Responsible for:
//   1. Hit-testing the cursor against the charm so the window can stay
//      click-through everywhere else (see main.js's setIgnoreMouseEvents).
//   2. Horizontal drag-to-reposition.
//   3. Damped pendulum "swing" physics on click/release.

(() => {
  const anchor = document.getElementById('anchor');
  const chain = document.getElementById('chain');
  const pivot = document.getElementById('pivot');
  const charmArt = document.getElementById('charm-art');

  const CHARM_PATHS = {
    sakthiman: 'assets/charms/doll.png',
    suba: 'assets/charms/doll2.png',
    classicMurugan: 'assets/charms/murugan.svg',
    classicVinayagar: 'assets/charms/vinayagar.svg'
  };
  const NORMAL_CHAIN_LENGTH = 46;

  let displayWidth = window.innerWidth;
  let xPercent = 50;
  let chainLength = NORMAL_CHAIN_LENGTH;
  let swingEnabled = true;

  // --- Swing physics state --------------------------------------------
  let angle = 0;            // degrees
  let angularVelocity = 0;  // degrees / frame
  let swingRafId = null;
  let chainSpringRafId = null;

  const STIFFNESS = 0.022;   // restoring force toward angle = 0
  const DAMPING = 0.965;     // energy loss per frame
  const REST_THRESHOLD = 0.05;

  function setAngleStyle() {
    pivot.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  }

  function stepSwing() {
    // Simple damped harmonic oscillator (small-angle pendulum).
    angularVelocity += -STIFFNESS * angle;
    angularVelocity *= DAMPING;
    angle += angularVelocity;
    setAngleStyle();

    if (Math.abs(angle) > REST_THRESHOLD || Math.abs(angularVelocity) > REST_THRESHOLD) {
      swingRafId = requestAnimationFrame(stepSwing);
    } else {
      angle = 0;
      angularVelocity = 0;
      setAngleStyle();
      swingRafId = null;
    }
  }

  function impulseSwing(startingAngularVelocity) {
    if (!swingEnabled) return;
    angularVelocity += startingAngularVelocity;
    // Clamp so a fast fling never looks unrealistic/violent.
    angularVelocity = Math.max(-6, Math.min(6, angularVelocity));
    if (swingRafId === null) {
      swingRafId = requestAnimationFrame(stepSwing);
    }
  }

  function stopSwingImmediately() {
    if (swingRafId !== null) {
      cancelAnimationFrame(swingRafId);
      swingRafId = null;
    }
    angle = 0;
    angularVelocity = 0;
    setAngleStyle();
  }

  // --- Horizontal position ---------------------------------------------
  function applyPosition() {
    anchor.style.left = `${xPercent}%`;
    chain.style.height = `${chainLength}px`;
  }

  function springChainBackTo(targetLength) {
    let velocity = 0;

    if (chainSpringRafId !== null) {
      cancelAnimationFrame(chainSpringRafId);
    }

    function stepChainSpring() {
      const force = (targetLength - chainLength) * 0.2;
      velocity = (velocity + force) * 0.86;
      chainLength += velocity;
      applyPosition();

      if (Math.abs(targetLength - chainLength) > 0.2 || Math.abs(velocity) > 0.2) {
        chainSpringRafId = requestAnimationFrame(stepChainSpring);
      } else {
        chainLength = targetLength;
        applyPosition();
        chainSpringRafId = null;
        persistPositionDebounced();
      }
    }

    chainSpringRafId = requestAnimationFrame(stepChainSpring);
  }

  function persistPositionDebounced() {
    clearTimeout(persistPositionDebounced._t);
    persistPositionDebounced._t = setTimeout(() => {
      window.api.updatePosition(xPercent);
      window.api.updateChainLength(chainLength);
    }, 250);
  }

  // --- Theme -------------------------------------------------------------
  function applyTheme(theme) {
    const src = CHARM_PATHS[theme] || CHARM_PATHS.murugan;
    charmArt.setAttribute('src', src);
  }

  // --- Drag handling -------------------------------------------------------
  let dragging = false;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartXPercent = 50;
  let dragStartChainLength = NORMAL_CHAIN_LENGTH;
  let lastMoveX = 0;
  let lastMoveTime = 0;
  let releaseVelocity = 0; // px/ms at moment of release
  let totalDragDistance = 0;

  function onDragStart(e) {
    dragging = true;
    totalDragDistance = 0;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    dragStartXPercent = xPercent;
    dragStartChainLength = chainLength;
    lastMoveX = e.clientX;
    lastMoveTime = performance.now();
    releaseVelocity = 0;

    stopSwingImmediately();
    window.api.setIgnoreMouseEvents(false);
    chain.classList.add('dragging');
    charmArt.classList.add('dragging');

    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragging) return;

    const now = performance.now();
    const dt = Math.max(1, now - lastMoveTime);
    releaseVelocity = (e.clientX - lastMoveX) / dt;
    lastMoveX = e.clientX;
    lastMoveTime = now;

    const deltaPx = e.clientX - dragStartClientX;
    totalDragDistance += Math.abs(deltaPx);
    lastPointerY = e.clientY;

    const deltaPercent = (deltaPx / displayWidth) * 100;
    xPercent = Math.max(2, Math.min(98, dragStartXPercent + deltaPercent));
    const deltaY = e.clientY - dragStartClientY;
    const maxChainLength = Math.max(20, window.innerHeight - charmArt.getBoundingClientRect().height - 8);
    chainLength = Math.max(20, Math.min(maxChainLength, dragStartChainLength + deltaY));
    applyPosition();
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    chain.classList.remove('dragging');
    charmArt.classList.remove('dragging');

    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);

    const verticalDragDistance = Math.abs(lastPointerY - dragStartClientY);

    // Stretching recoils to its resting length like a rubber cord.
    if (verticalDragDistance >= 5) {
      stopSwingImmediately();
      springChainBackTo(NORMAL_CHAIN_LENGTH);
    } else if (totalDragDistance < 5) {
      impulseSwing(2.2);
      persistPositionDebounced();
    } else {
      // Map px/ms velocity to an angular kick.
      impulseSwing(releaseVelocity * 40);
      persistPositionDebounced();
    }

    // Resume normal hover-based click-through behavior.
    updateIgnoreMouseEventsForPoint(lastPointerX, lastPointerY);
  }

  // --- Hover-based click-through hit testing -----------------------------
  // Because the window is transparent and covers the whole display, we
  // must actively tell the main process when the cursor is over the
  // charm (mouse events should register) versus anywhere else (mouse
  // events should pass through to whatever is beneath the window).
  let lastIgnoreState = true;
  let lastPointerX = 0;
  let lastPointerY = 0;

  function updateIgnoreMouseEventsForPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const overCharm = !!(el && el.closest && el.closest('.draggable'));
    const shouldIgnore = !overCharm;
    if (shouldIgnore !== lastIgnoreState) {
      lastIgnoreState = shouldIgnore;
      window.api.setIgnoreMouseEvents(shouldIgnore);
    }
  }

  document.addEventListener('mousemove', (e) => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (dragging) return; // ignore-state is pinned to "false" while dragging
    updateIgnoreMouseEventsForPoint(e.clientX, e.clientY);
  });

  chain.addEventListener('mousedown', onDragStart);
  charmArt.addEventListener('mousedown', onDragStart);

  // --- Context menu --------------------------------------------------------
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.showContextMenu();
  });

  // --- Wire up state from main process --------------------------------------
  window.api.onInit((payload) => {
    displayWidth = payload.displayWidth || window.innerWidth;
    xPercent = payload.xPercent ?? 50;
    chainLength = NORMAL_CHAIN_LENGTH;
    swingEnabled = payload.swingEnabled ?? true;
    applyTheme(payload.theme || 'murugan');
    applyPosition();
  });

  window.api.onThemeChanged((theme) => applyTheme(theme));

  window.api.onSwingEnabledChanged((enabled) => {
    swingEnabled = enabled;
    if (!enabled) stopSwingImmediately();
  });

  window.api.onTriggerSwing(() => {
    impulseSwing(3.2);
  });

  window.addEventListener('resize', () => {
    displayWidth = window.innerWidth;
  });
})();
