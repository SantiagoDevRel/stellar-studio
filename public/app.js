// === Stars Background ===
function initStars() {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const stars = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 1.5 + 0.5,
    speed: Math.random() * 0.3 + 0.05,
    opacity: Math.random() * 0.8 + 0.2,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const star of stars) {
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 180, 255, ${star.opacity})`;
      ctx.fill();
      star.opacity += (Math.random() - 0.5) * 0.02;
      star.opacity = Math.max(0.1, Math.min(1, star.opacity));
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// === Placeholder for app logic (Step 3) ===
document.addEventListener('DOMContentLoaded', () => {
  initStars();
});
