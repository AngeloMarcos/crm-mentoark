I will add a beautiful particle background to the login screen using a modern implementation of particles.js, combined with a purple-to-blue gradient as requested.

### Steps
1. **Install Dependencies**: Add `@tsparticles/react` and `@tsparticles/slim` to the project for efficient particle effects.
2. **Create Particle Component**: Develop a reusable `ParticlesBackground` component that replicates the look and feel of the user's reference.
3. **Enhance Login Page**:
    - Apply a vibrant purple-blue gradient background to `src/pages/Login.tsx`.
    - Integrate the particle effect behind the login card.
    - Update the UI elements (card, text, logo) to ensure they pop against the new background while maintaining a professional "glassmorphism" aesthetic.
4. **Final Polish**: Adjust particle density, speed, and colors to match the blue/purple theme perfectly.

### Technical details
- Using `@tsparticles/react` for the particle engine.
- Tailwind CSS for the gradient (`from-purple-900 via-blue-900 to-indigo-950`).
- Glassmorphism effects for the login card using `backdrop-blur`.
