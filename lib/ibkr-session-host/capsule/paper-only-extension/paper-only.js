(() => {
  "use strict";

  const selector = ".xyz-paper-switch";

  function forcePaperMode() {
    const paperSwitch = document.querySelector(selector);
    if (!(paperSwitch instanceof HTMLInputElement)) {
      return;
    }

    if (!paperSwitch.checked) {
      paperSwitch.checked = true;
      paperSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    }
    paperSwitch.disabled = true;
    paperSwitch.setAttribute("aria-checked", "true");
    paperSwitch.closest(".xyz-paperswitch")?.setAttribute(
      "aria-label",
      "Paper Trading only",
    );
  }

  document.addEventListener(
    "change",
    (event) => {
      if (event.target instanceof Element && event.target.matches(selector)) {
        forcePaperMode();
      }
    },
    true,
  );

  new MutationObserver(forcePaperMode).observe(document, {
    childList: true,
    subtree: true,
  });
  forcePaperMode();
})();
