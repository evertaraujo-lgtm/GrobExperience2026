const mediaResponse = await fetch("/data/home-media.json");
const media = mediaResponse.ok ? await mediaResponse.json() : { heroVideos: [], historySlides: [] };

const heroVideos = Array.isArray(media.heroVideos) ? media.heroVideos.filter((item) => item?.src) : [];
const historySlides = Array.isArray(media.historySlides) ? media.historySlides.filter((item) => item?.image) : [];

function setupVideoCarousel() {
  const video = document.querySelector("[data-hero-video]");
  const controls = document.querySelector("[data-video-controls]");
  const counter = document.querySelector("[data-video-count]");
  if (!video || !heroVideos.length) return;

  let activeIndex = 0;
  const showVideo = (index) => {
    activeIndex = (index + heroVideos.length) % heroVideos.length;
    const item = heroVideos[activeIndex];
    video.src = item.src;
    video.poster = item.poster || "/img/fundo.jpg";
    video.setAttribute("aria-label", item.label || `Vídeo ${activeIndex + 1}`);
    video.load();
    video.play().catch(() => {});
    if (counter) counter.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(heroVideos.length).padStart(2, "0")}`;
  };

  if (heroVideos.length > 1 && controls) {
    controls.hidden = false;
    document.querySelector("[data-video-prev]")?.addEventListener("click", () => showVideo(activeIndex - 1));
    document.querySelector("[data-video-next]")?.addEventListener("click", () => showVideo(activeIndex + 1));
  }
  showVideo(0);
}

function setupHistoryCarousel() {
  const carousel = document.querySelector("[data-history-carousel]");
  if (!carousel || !historySlides.length) return;

  const image = carousel.querySelector("[data-history-image]");
  const year = carousel.querySelector("[data-history-year]");
  const label = carousel.querySelector("[data-history-label]");
  const title = carousel.querySelector("[data-history-title]");
  const copy = carousel.querySelector("[data-history-copy]");
  const current = carousel.querySelector("[data-history-current]");
  const total = carousel.querySelector("[data-history-total]");
  const dots = carousel.querySelector("[data-history-dots]");
  let activeIndex = 0;
  let timer;

  total.textContent = String(historySlides.length).padStart(2, "0");

  const render = (index) => {
    activeIndex = (index + historySlides.length) % historySlides.length;
    const item = historySlides[activeIndex];
    image.classList.add("is-changing");
    image.onerror = () => {
      if (item.fallback && image.src !== new URL(item.fallback, window.location.href).href) image.src = item.fallback;
    };
    image.src = item.image;
    image.alt = item.alt || `${item.year} · ${item.title}`;
    year.textContent = item.year || "";
    label.textContent = item.label || "Nossa trajetória";
    title.textContent = item.title || "";
    copy.textContent = item.copy || "";
    current.textContent = String(activeIndex + 1).padStart(2, "0");
    [...dots.children].forEach((dot, dotIndex) => {
      dot.setAttribute("aria-current", dotIndex === activeIndex ? "true" : "false");
    });
    window.setTimeout(() => image.classList.remove("is-changing"), 220);
  };

  historySlides.forEach((item, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Ver ${item.year}: ${item.label || item.title}`);
    dot.addEventListener("click", () => {
      render(index);
      restartTimer();
    });
    dots.append(dot);
  });

  const restartTimer = () => {
    window.clearInterval(timer);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = window.setInterval(() => render(activeIndex + 1), 8000);
    }
  };

  carousel.querySelector("[data-history-prev]").addEventListener("click", () => {
    render(activeIndex - 1);
    restartTimer();
  });
  carousel.querySelector("[data-history-next]").addEventListener("click", () => {
    render(activeIndex + 1);
    restartTimer();
  });
  carousel.addEventListener("pointerenter", () => window.clearInterval(timer));
  carousel.addEventListener("pointerleave", restartTimer);
  carousel.addEventListener("focusin", () => window.clearInterval(timer));
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) restartTimer();
  });

  render(0);
  restartTimer();
}

setupVideoCarousel();
setupHistoryCarousel();
