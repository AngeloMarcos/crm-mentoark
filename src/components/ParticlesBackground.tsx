import React, { useEffect, useRef } from 'react';

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
}

const ParticlesBackground: React.FC<ParticlesBackgroundProps> = ({ 
  className = "fixed inset-0 pointer-events-none z-0",
  count = 80,
  connectionDistance = 150
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      const purple = isLightTheme ? '124, 58, 237' : '168, 85, 247';
      const blue = isLightTheme ? '37, 99, 235' : '59, 130, 246';
      const particleAlpha = isLightTheme ? 1 : 0.9;
      const connectionAlpha = isLightTheme ? 0.85 : 0.65;
      const lineWidth = isLightTheme ? 1.1 : 0.7;
      
      particles.forEach((p, i) => {
        // Interaction with mouse
        const dxMouse = mouse.x - p.x;
        const dyMouse = mouse.y - p.y;
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
        if (distMouse < mouse.radius) {
          const force = (mouse.radius - distMouse) / mouse.radius;
          p.x -= dxMouse * force * 0.02;
          p.y -= dyMouse * force * 0.02;
        }

        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off walls
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.shadowBlur = isLightTheme ? 8 : 6;
        ctx.shadowColor = i % 2 === 0 ? `rgba(${purple}, 0.65)` : `rgba(${blue}, 0.65)`;
        ctx.fillStyle = i % 2 === 0 ? `rgba(${purple}, ${particleAlpha})` : `rgba(${blue}, ${particleAlpha})`;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Connect particles
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
    <canvas
      ref={canvasRef}
      className={className}
      style={{ background: 'transparent', display: 'block' }}
    />
  );
};

export default ParticlesBackground;
