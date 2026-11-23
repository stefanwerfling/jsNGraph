/* Animal and boat sprites for the ocean examples (seabird-radar.html, gomera.html).
 * Every function draws one figure in a unit box (about −0.7…0.7 wide) scaled by `s` px,
 * centred at (x, y); `dir` 1 faces right, −1 left. Made for these pages, not part of the library. */
(() => {
const DOLPHIN = {
    common: ['#3a4c5c', '#6f8798', '#e8eef2'],
    bottlenose: ['#56636e', '#86939e', '#dce2e6'],
    spotted: ['#46525e', '#76848f', '#e6ecf0']
};
window.OceanArt = {
    gannet(ctx, x, y, s, dir, flap, mode, k) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(dir * s, s);
        if (mode === 'dive') {
            ctx.rotate(Math.PI / 2 * Math.min(1, 0.4 + k));
            // folded: a white dart with black wing tips along the body
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(0.62, 0); ctx.quadraticCurveTo(0.2, -0.12, -0.45, -0.05); ctx.lineTo(-0.55, 0); ctx.lineTo(-0.45, 0.05);
            ctx.quadraticCurveTo(0.2, 0.12, 0.62, 0); ctx.fill();
            ctx.fillStyle = '#1d2a33';
            ctx.beginPath(); ctx.moveTo(-0.1, -0.06); ctx.lineTo(-0.62, -0.1); ctx.lineTo(-0.3, -0.02); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-0.1, 0.06); ctx.lineTo(-0.62, 0.1); ctx.lineTo(-0.3, 0.02); ctx.fill();
            ctx.fillStyle = '#f2d98a'; ctx.beginPath(); ctx.arc(0.42, 0, 0.07, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            return;
        }
        const up = 0.35 + 0.65 * flap;     // −0.3 … 1
        const wing = (sign, fore) => {
            const tipY = -sign * 0.95 * up * fore, elbowY = -sign * 0.42 * up * fore;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(0.12, 0);
            ctx.quadraticCurveTo(0.05, elbowY * 1.1, -0.05, elbowY);
            ctx.lineTo(-0.28, tipY);
            ctx.lineTo(-0.36, tipY * 0.92);
            ctx.quadraticCurveTo(-0.22, elbowY * 0.9, -0.18, 0);
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = 'rgba(40,60,80,0.35)'; ctx.lineWidth = 0.02; ctx.stroke();
            // black primaries
            ctx.fillStyle = '#1d2a33';
            ctx.beginPath();
            ctx.moveTo(-0.13, elbowY + (tipY - elbowY) * 0.35);
            ctx.lineTo(-0.28, tipY); ctx.lineTo(-0.36, tipY * 0.92);
            ctx.lineTo(-0.23, elbowY + (tipY - elbowY) * 0.3);
            ctx.closePath(); ctx.fill();
        };
        wing(-1, 0.55);                       // far wing, foreshortened
        // body
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0.62, 0.01);
        ctx.quadraticCurveTo(0.45, -0.1, 0.2, -0.08);
        ctx.quadraticCurveTo(-0.3, -0.08, -0.55, 0);
        ctx.quadraticCurveTo(-0.3, 0.08, 0.2, 0.08);
        ctx.quadraticCurveTo(0.45, 0.08, 0.62, 0.01);
        ctx.fill();
        ctx.strokeStyle = 'rgba(40,60,80,0.4)'; ctx.lineWidth = 0.02; ctx.stroke();
        ctx.fillStyle = '#f2d98a'; ctx.beginPath(); ctx.arc(0.42, -0.02, 0.07, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9aa7b0'; ctx.beginPath(); ctx.moveTo(0.6, -0.01); ctx.lineTo(0.78, 0.02); ctx.lineTo(0.6, 0.03); ctx.fill();
        ctx.fillStyle = '#1d2a33'; ctx.beginPath(); ctx.arc(0.47, -0.04, 0.018, 0, Math.PI * 2); ctx.fill();
        wing(1, 1);                           // near wing
        ctx.restore();
    },

    gull(ctx, x, y, s, bob) {
        ctx.save();
        ctx.translate(x, y + Math.sin(bob) * s * 0.03);
        ctx.scale(s, s);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9fb0bd';
        ctx.beginPath(); ctx.ellipse(-0.05, -0.06, 0.32, 0.09, -0.08, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1d2a33';
        ctx.beginPath(); ctx.moveTo(-0.3, -0.07); ctx.lineTo(-0.52, -0.1); ctx.lineTo(-0.34, -0.02); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0.36, -0.15, 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f2b632';
        ctx.beginPath(); ctx.moveTo(0.44, -0.15); ctx.lineTo(0.58, -0.13); ctx.lineTo(0.44, -0.11); ctx.fill();
        ctx.strokeStyle = 'rgba(30,60,90,0.35)'; ctx.lineWidth = 0.02;
        ctx.beginPath(); ctx.ellipse(0, 0, 0.42, 0.16, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
    },

    tuna(ctx, x, y, s, dir, wag) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(dir * s, s);
        const g = ctx.createLinearGradient(0, -0.2, 0, 0.2);
        g.addColorStop(0, '#0f3f74'); g.addColorStop(0.45, '#2f7fc1'); g.addColorStop(1, '#cfe6f5');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0.52, 0.02);
        ctx.bezierCurveTo(0.42, -0.16, 0.05, -0.21, -0.3, -0.08);
        ctx.lineTo(-0.42, -0.025);
        ctx.lineTo(-0.62, -0.2 + wag); ctx.lineTo(-0.55, 0 + wag * 0.5); ctx.lineTo(-0.62, 0.2 + wag);
        ctx.lineTo(-0.42, 0.025);
        ctx.lineTo(-0.3, 0.08);
        ctx.bezierCurveTo(0.05, 0.19, 0.42, 0.14, 0.52, 0.02);
        ctx.fill();
        // fins + finlets
        ctx.fillStyle = '#0f3f74';
        ctx.beginPath(); ctx.moveTo(0.05, -0.17); ctx.lineTo(-0.08, -0.3); ctx.lineTo(-0.12, -0.15); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0.18, 0.04); ctx.lineTo(-0.05, 0.12); ctx.lineTo(0.1, 0.06); ctx.fill();
        ctx.fillStyle = '#f5c518';
        for (let i = 0; i < 5; i++) { ctx.fillRect(-0.2 - i * 0.045, -0.085 + i * 0.01, 0.025, 0.025); ctx.fillRect(-0.2 - i * 0.045, 0.06 - i * 0.01, 0.025, 0.025); }
        ctx.fillStyle = '#0b2033'; ctx.beginPath(); ctx.arc(0.4, -0.02, 0.025, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    // species: 'common' (hourglass flank), 'bottlenose' (plain grey), 'spotted' (Atlantic spotted)
    dolphin(ctx, x, y, s, angle, dir, alpha = 1, species = 'common') {
        const tone = DOLPHIN[species] ?? DOLPHIN.common;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(dir * s, s);
        const g = ctx.createLinearGradient(0, -0.13, 0, 0.12);
        g.addColorStop(0, tone[0]); g.addColorStop(0.55, tone[1]); g.addColorStop(1, tone[2]);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0.62, 0.0);                       // beak
        ctx.lineTo(0.5, -0.01);
        ctx.quadraticCurveTo(0.42, -0.1, 0.28, -0.11);   // melon
        ctx.quadraticCurveTo(-0.1, -0.13, -0.45, -0.03);
        ctx.lineTo(-0.5, -0.015);
        ctx.quadraticCurveTo(-0.62, -0.08, -0.7, -0.07);  // fluke
        ctx.quadraticCurveTo(-0.62, 0, -0.7, 0.07);
        ctx.quadraticCurveTo(-0.62, 0.08, -0.5, 0.015);
        ctx.lineTo(-0.45, 0.03);
        ctx.quadraticCurveTo(-0.1, 0.1, 0.3, 0.07);
        ctx.quadraticCurveTo(0.45, 0.05, 0.5, 0.02);
        ctx.lineTo(0.62, 0.005);
        ctx.fill();
        ctx.fillStyle = tone[0];
        ctx.beginPath(); ctx.moveTo(0.02, -0.11); ctx.quadraticCurveTo(-0.05, -0.26, -0.16, -0.28); ctx.quadraticCurveTo(-0.1, -0.18, -0.16, -0.1); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0.22, 0.05); ctx.quadraticCurveTo(0.1, 0.16, 0.04, 0.17); ctx.quadraticCurveTo(0.1, 0.09, 0.12, 0.06); ctx.fill();
        // hourglass flank pattern of common dolphins
        if (species === 'common') {
            ctx.fillStyle = 'rgba(240,215,150,0.55)';
            ctx.beginPath(); ctx.ellipse(0.18, 0.01, 0.16, 0.035, -0.1, 0, Math.PI * 2); ctx.fill();
        } else if (species === 'spotted') {
            ctx.fillStyle = 'rgba(235,240,245,0.75)';
            for (let i = 0; i < 16; i++) {
                const sx = 0.38 - (i * 0.61803 % 1) * 0.8, sy = -0.08 + (i * 0.41421 % 1) * 0.14;
                ctx.beginPath(); ctx.arc(sx, sy, 0.011, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.fillStyle = '#0b1620'; ctx.beginPath(); ctx.arc(0.43, -0.03, 0.017, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    humpback(ctx, x, y, s, dir, angle = 0, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(dir * s, s);
        const g = ctx.createLinearGradient(0, -0.1, 0, 0.12);
        g.addColorStop(0, '#24323f'); g.addColorStop(0.6, '#3d5060'); g.addColorStop(1, '#8a9aa6');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0.5, 0.02);
        ctx.quadraticCurveTo(0.46, -0.07, 0.3, -0.085);
        ctx.quadraticCurveTo(0.0, -0.11, -0.2, -0.08);
        ctx.lineTo(-0.23, -0.11); ctx.lineTo(-0.27, -0.075);       // small dorsal hump
        ctx.quadraticCurveTo(-0.4, -0.05, -0.47, -0.015);
        ctx.quadraticCurveTo(-0.58, -0.09, -0.66, -0.08);           // flukes
        ctx.quadraticCurveTo(-0.6, 0, -0.66, 0.08);
        ctx.quadraticCurveTo(-0.58, 0.09, -0.47, 0.015);
        ctx.quadraticCurveTo(-0.3, 0.07, 0.0, 0.1);
        ctx.quadraticCurveTo(0.35, 0.11, 0.5, 0.02);
        ctx.fill();
        // throat grooves
        ctx.strokeStyle = 'rgba(200,215,225,0.35)'; ctx.lineWidth = 0.008;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0.44, 0.04 + i * 0.012); ctx.quadraticCurveTo(0.25, 0.09 + i * 0.01, 0.08, 0.09 + i * 0.006); ctx.stroke(); }
        // long pectoral fin (white underside)
        ctx.fillStyle = '#c9d4db';
        ctx.beginPath(); ctx.moveTo(0.22, 0.06); ctx.quadraticCurveTo(0.12, 0.2, -0.06, 0.27); ctx.quadraticCurveTo(0.06, 0.16, 0.12, 0.07); ctx.fill();
        // knobs on the head
        ctx.fillStyle = 'rgba(150,170,185,0.6)';
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(0.46 - i * 0.035, -0.055 - Math.sin(i) * 0.008, 0.006, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#0b1620'; ctx.beginPath(); ctx.arc(0.32, 0.03, 0.01, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    fluke(ctx, x, y, s, k, color = '#24323f') {
        // the tail stock rises out of the water, then slides back in
        const h = Math.sin(Math.PI * Math.min(1, k * 1.1)) * 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.beginPath(); ctx.rect(-1, -2, 2, 2); ctx.clip();      // above the waterline only
        ctx.translate(0, (1 - h) * 0.55);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-0.04, 0.2); ctx.lineTo(-0.035, -0.25);
        ctx.quadraticCurveTo(-0.2, -0.3, -0.36, -0.45); ctx.quadraticCurveTo(-0.2, -0.47, -0.02, -0.36);
        ctx.lineTo(0.02, -0.36);
        ctx.quadraticCurveTo(0.2, -0.47, 0.36, -0.45); ctx.quadraticCurveTo(0.2, -0.3, 0.035, -0.25);
        ctx.lineTo(0.04, 0.2); ctx.fill();
        ctx.fillStyle = 'rgba(230,236,240,0.8)';
        ctx.beginPath(); ctx.moveTo(-0.3, -0.43); ctx.quadraticCurveTo(-0.15, -0.36, -0.04, -0.3); ctx.quadraticCurveTo(-0.16, -0.43, -0.3, -0.43); ctx.fill();
        // water running off
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.01;
        for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 0.09, -0.42 + Math.abs(i) * 0.01); ctx.lineTo(i * 0.09, -0.42 + 0.3 * k); ctx.stroke(); }
        ctx.restore();
    },

    // short-finned pilot whale: black, round melon, broad sickle fin well forward
    pilot(ctx, x, y, s, dir, angle = 0, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(dir * s, s);
        ctx.fillStyle = '#15191d';
        ctx.beginPath();
        ctx.moveTo(0.52, 0.02);
        ctx.bezierCurveTo(0.53, -0.1, 0.38, -0.13, 0.22, -0.1);     // bulbous melon
        ctx.quadraticCurveTo(0.0, -0.09, -0.3, -0.05);
        ctx.quadraticCurveTo(-0.44, -0.03, -0.5, -0.012);
        ctx.quadraticCurveTo(-0.6, -0.08, -0.68, -0.07);
        ctx.quadraticCurveTo(-0.61, 0, -0.68, 0.07);
        ctx.quadraticCurveTo(-0.6, 0.08, -0.5, 0.012);
        ctx.quadraticCurveTo(-0.3, 0.06, 0.0, 0.08);
        ctx.quadraticCurveTo(0.38, 0.1, 0.52, 0.02);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0.16, -0.095); ctx.quadraticCurveTo(0.12, -0.24, -0.02, -0.25);
        ctx.quadraticCurveTo(0.0, -0.17, -0.06, -0.09); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0.3, 0.06); ctx.quadraticCurveTo(0.18, 0.2, 0.08, 0.21); ctx.quadraticCurveTo(0.16, 0.12, 0.2, 0.07); ctx.fill();
        ctx.fillStyle = 'rgba(160,175,185,0.35)';
        ctx.beginPath(); ctx.ellipse(0.2, 0.075, 0.12, 0.015, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    // sperm whale: box head (a third of the body), wrinkled grey-brown skin, low hump + knuckles
    sperm(ctx, x, y, s, dir, angle = 0, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(dir * s, s);
        const g = ctx.createLinearGradient(0, -0.12, 0, 0.12);
        g.addColorStop(0, '#3b3632'); g.addColorStop(1, '#6d665f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0.52, -0.1);
        ctx.lineTo(0.53, 0.04);
        ctx.quadraticCurveTo(0.5, 0.09, 0.3, 0.09);
        ctx.lineTo(0.15, 0.1);
        ctx.quadraticCurveTo(-0.2, 0.08, -0.46, 0.015);
        ctx.quadraticCurveTo(-0.58, 0.08, -0.68, 0.075);
        ctx.quadraticCurveTo(-0.6, 0, -0.68, -0.075);
        ctx.quadraticCurveTo(-0.58, -0.08, -0.46, -0.015);
        ctx.lineTo(-0.3, -0.04);
        for (let i = 0; i < 4; i++) { ctx.lineTo(-0.27 + i * 0.05, -0.06); ctx.lineTo(-0.25 + i * 0.05, -0.05); }   // knuckles
        ctx.lineTo(-0.08, -0.07);
        ctx.lineTo(-0.12, -0.11); ctx.lineTo(-0.02, -0.08);                                                 // hump
        ctx.quadraticCurveTo(0.2, -0.11, 0.52, -0.1);
        ctx.fill();
        // lower jaw, slim, under the head
        ctx.strokeStyle = 'rgba(230,225,215,0.6)'; ctx.lineWidth = 0.012;
        ctx.beginPath(); ctx.moveTo(0.48, 0.07); ctx.lineTo(0.2, 0.085); ctx.stroke();
        // wrinkles behind the head
        ctx.strokeStyle = 'rgba(20,18,16,0.35)'; ctx.lineWidth = 0.006;
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0.1 - i * 0.07, -0.06); ctx.quadraticCurveTo(0.08 - i * 0.07, 0.0, 0.1 - i * 0.07, 0.06); ctx.stroke(); }
        ctx.fillStyle = '#3b3632';
        ctx.beginPath(); ctx.moveTo(0.24, 0.07); ctx.quadraticCurveTo(0.2, 0.15, 0.13, 0.15); ctx.quadraticCurveTo(0.17, 0.1, 0.18, 0.07); ctx.fill();
        ctx.fillStyle = '#0b0a09'; ctx.beginPath(); ctx.arc(0.22, 0.03, 0.01, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    // a sperm whale blow goes forward and to the left (one nostril at the front left of the head)
    blowAngle: {humpback: 0, pilot: 0, sperm: -0.7},

    // Cory's shearwater: brown above, white below, long stiff wings, glides low with banking
    shearwater(ctx, x, y, s, dir, bank) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(bank * 0.5);
        ctx.scale(dir * s, s);
        const wing = (sign, fore) => {
            ctx.fillStyle = sign < 0 ? '#5d4b3b' : '#7a6450';
            ctx.beginPath();
            ctx.moveTo(0.1, 0);
            ctx.quadraticCurveTo(0.0, -sign * 0.25 * fore, -0.12, -sign * 0.62 * fore);
            ctx.lineTo(-0.2, -sign * 0.6 * fore);
            ctx.quadraticCurveTo(-0.12, -sign * 0.2 * fore, -0.16, 0);
            ctx.closePath(); ctx.fill();
        };
        wing(-1, 0.4 + 0.2 * bank);
        ctx.fillStyle = '#f4f1ea';
        ctx.beginPath();
        ctx.moveTo(0.42, 0);
        ctx.quadraticCurveTo(0.3, -0.07, 0.1, -0.06);
        ctx.quadraticCurveTo(-0.25, -0.05, -0.4, 0);
        ctx.quadraticCurveTo(-0.25, 0.05, 0.1, 0.06);
        ctx.quadraticCurveTo(0.3, 0.06, 0.42, 0);
        ctx.fill();
        ctx.fillStyle = '#7a6450';
        ctx.beginPath(); ctx.moveTo(0.42, 0); ctx.quadraticCurveTo(0.3, -0.07, 0.1, -0.06); ctx.quadraticCurveTo(-0.25, -0.05, -0.4, 0); ctx.quadraticCurveTo(0.0, -0.01, 0.42, 0); ctx.fill();
        ctx.fillStyle = '#e8c45a'; ctx.beginPath(); ctx.moveTo(0.41, -0.01); ctx.lineTo(0.55, 0.005); ctx.lineTo(0.41, 0.02); ctx.fill();
        wing(1, 1 - 0.2 * bank);
        ctx.restore();
    },

    // a small whale-watching boat seen from the side; dir 1 = bow to the right
    boat(ctx, x, y, s, dir, antenna) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(dir * s, s);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#2b3a46'; ctx.lineWidth = 0.012;
        ctx.beginPath();
        ctx.moveTo(-0.48, -0.06); ctx.lineTo(0.42, -0.06); ctx.quadraticCurveTo(0.52, -0.06, 0.55, -0.1);
        ctx.lineTo(0.44, 0.08); ctx.lineTo(-0.44, 0.08); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1f6fb2'; ctx.fillRect(-0.44, 0.03, 0.88, 0.035);
        ctx.fillStyle = '#eef3f6';
        ctx.beginPath(); ctx.moveTo(-0.3, -0.06); ctx.lineTo(-0.28, -0.2); ctx.lineTo(0.16, -0.2); ctx.lineTo(0.24, -0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2b3a46';
        for (let i = 0; i < 5; i++) ctx.fillRect(-0.24 + i * 0.085, -0.17, 0.05, 0.05);
        // people on the bow, looking out
        ctx.fillStyle = '#e0573c'; ctx.fillRect(0.3, -0.13, 0.025, 0.07);
        ctx.fillStyle = '#f2c14e'; ctx.fillRect(0.36, -0.12, 0.025, 0.06);
        // mast with the radar bar
        ctx.beginPath(); ctx.moveTo(-0.05, -0.2); ctx.lineTo(-0.05, -0.34); ctx.stroke();
        ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(-0.05 - Math.sin(antenna) * 0.09, -0.35); ctx.lineTo(-0.05 + Math.sin(antenna) * 0.09, -0.35); ctx.stroke();
        ctx.restore();
    },

    // a giant squid, only the suggestion of one, for the deep cut
    squid(ctx, x, y, s, t) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.fillStyle = 'rgba(190,70,60,0.8)';
        ctx.beginPath(); ctx.ellipse(0.2, 0, 0.22, 0.06, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0.42, 0); ctx.lineTo(0.48, -0.06); ctx.lineTo(0.48, 0.06); ctx.fill();
        ctx.strokeStyle = 'rgba(190,70,60,0.75)'; ctx.lineWidth = 0.02; ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
            const off = (i - 3.5) * 0.015;
            ctx.beginPath(); ctx.moveTo(0, off);
            ctx.bezierCurveTo(-0.15, off + Math.sin(t * 2 + i) * 0.05, -0.3, off * 3 + Math.sin(t * 2 + i + 1) * 0.08, -0.5 - (i % 2) * 0.12, off * 5 + Math.sin(t * 2 + i + 2) * 0.1);
            ctx.stroke();
        }
        ctx.restore();
    },
};
})();
