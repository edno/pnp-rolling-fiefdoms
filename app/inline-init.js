/**
 * Rolling Fiefdoms - Page chrome init
 *
 * Small page-level behaviors that don't belong in the game bundle:
 * footer year and the "back to top" button visibility.
 */

document.getElementById("currentYear").textContent = new Date().getFullYear();

const backToTopBtn = document.getElementById("backToTopBtn");
const landingInfo = document.querySelector(".landing-info");
if (backToTopBtn && landingInfo && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        backToTopBtn.classList.toggle("visible", entry.isIntersecting);
      });
    },
    { threshold: 0 }
  );
  observer.observe(landingInfo);
  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
