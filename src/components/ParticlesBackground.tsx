import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

interface ParticlesBackgroundProps {
  className?: string;
  count?: number;
  connectionDistance?: number;
  showContrastToggle?: boolean;
}

const STORAGE_KEY = 'particles_high_contrast';

const ParticlesBackground: React.FC<ParticlesBackgroundProps> = ({
  className = "fixed inset-0 pointer-events-none z-0",
  count = 80,
  connectionDistance = 150,
  showContrastToggle = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [highContrast, setHighContrast] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === '1';
  });
  const highContrastRef = useRef(highContrast);

  useEffect(() => {
    highContrastRef.current = highContrast;
    try {
      localStorage.setItem(STORAGE_KEY, highContrast ? '1' : '0');
      window.dispatchEvent(new CustomEvent('particles-contrast-change', { detail: highContrast }));
    } catch {}
  }, [highContrast]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      if (typeof detail === 'boolean') setHighContrast(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHighContrast(e.newValue === '1');
    };
    window.addEventListener('particles-contrast-change', onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('particles-contrast-change', onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];
    const particleCount = count;
    const connDist = connectionDistance;
    const mouse = { x: -100, y: -100, radius: 150 };

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      const h = parent ? parent.clientHeight : window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      initParticles();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (canvas.parentElement && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(canvas.parentElement);
    }

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          size: Math.random() * 2 + 1,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isLightTheme = !document.documentElement.classList.contains('dark');
      const hc = highContrastRef.current;

      // Color palette
      let purple: string;
      let blue: string;
      let particleAlpha: number;
      let connectionAlpha: number;
      let lineWidth: number;
      let sizeBoost: number;
      let shadowBlur: number;
      let shadowAlpha: number;
      let strokeOutline = false;

      if (hc) {
        // High contrast: stark colors that pop on any background
        if (isLightTheme) {
          purple = '49, 0, 130';   // deep indigo
          blue = '0, 32, 96';      // deep navy
        } else {
          purple = '236, 220, 255'; // near-white lavender
          blue = '210, 235, 255';   // near-white sky
        }
        particleAlpha = 1;
        connectionAlpha = 1;
        lineWidth = 1.8;
        sizeBoost = 1.6;
        shadowBlur = isLightTheme ? 0 : 14;
        shadowAlpha = 0.9;
        strokeOutline = true;
      } else {
        purple = isLightTheme ? '124, 58, 237' : '168, 85, 247';
        blue = isLightTheme ? '37, 99, 235' : '59, 130, 246';
        particleAlpha = isLightTheme ? 1 : 0.9;
        connectionAlpha = isLightTheme ? 0.85 : 0.65;
        lineWidth = isLightTheme ? 1.1 : 0.7;
        sizeBoost = 1;
        shadowBlur = isLightTheme ? 8 : 6;
        shadowAlpha = 0.65;
      }

      particles.forEach((p, i) => {
        const dxMouse = mouse.x - p.x;
        const dyMouse = mouse.y - p.y;
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
        if (distMouse < mouse.radius) {
          const force = (mouse.radius - distMouse) / mouse.radius;
          p.x -= dxMouse * force * 0.02;
          p.y -= dyMouse * force * 0.02;
        }

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const color = i % 2 === 0 ? purple : blue;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * sizeBoost, 0, Math.PI * 2);
        ctx.shadowBlur = shadowBlur;
        ctx.shadowColor = `rgba(${color}, ${shadowAlpha})`;
        ctx.fillStyle = `rgba(${color}, ${particleAlpha})`;
        ctx.fill();
        if (strokeOutline) {
          ctx.shadowBlur = 0;
          ctx.lineWidth = 1;
          ctx.strokeStyle = isLightTheme ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)';
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < connDist) {
            ctx.beginPath();
            const alpha = (1 - dist / connDist) * connectionAlpha;
            const gradient = ctx.createLinearGradient(p.x, p.y, p2.x, p2.y);
            gradient.addColorStop(0, `rgba(${purple}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${blue}, ${alpha})`);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = lineWidth;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);

    resize();
    draw();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [count, connectionDistance]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        style={{ background: 'transparent', display: 'block' }}
      />
      {showContrastToggle && (
        <button
          type="button"
          onClick={() => setHighContrast((v) => !v)}
          aria-pressed={highContrast}
          aria-label={highContrast ? 'Desativar alto contraste das partículas' : 'Ativar alto contraste das partículas'}
          title={highContrast ? 'Alto contraste: ativo' : 'Alto contraste: desativado'}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-background/80 backdrop-blur px-3 py-2 text-xs font-medium text-foreground shadow-md hover:bg-background transition-colors"
        >
          {highContrast ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          <span className="hidden sm:inline">{highContrast ? 'Alto contraste' : 'Contraste normal'}</span>
        </button>
      )}
    </>
  );
};

export default ParticlesBackground;
