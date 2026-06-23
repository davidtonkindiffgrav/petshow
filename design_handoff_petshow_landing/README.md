# Handoff: PetShow Online — Marketing Landing Page

## Overview
This is the marketing landing page for **PetShow Online**, a web platform for hosting **virtual pet shows and fundraising events**. The page communicates three things at a glance: (1) virtual pet shows are easy to run, (2) fundraising is a core feature, and (3) the experience is fun and community-focused. The tone is friendly, joyful, trustworthy, and community-oriented — "Etsy meets Canva meets Airbnb, for pet lovers."

> **Brand name is provisional.** "PetShow Online" is a placeholder and will likely change. Treat the wordmark/logo as a single swappable component.

## About the Design Files
The files in this bundle are **design references created in HTML** — a high-fidelity prototype showing the intended look, layout, copy, and behavior. They are **not production code to copy directly**.

- `PetShow Online.dc.html` is authored as a "Design Component" (a streaming HTML format with a small custom runtime + inline styles). **Do not** port the `<x-dc>` / `support.js` / `x-import` scaffolding into your app — read it as a visual spec only.
- Your task: **recreate this design in the target codebase's environment** (React/Next, Vue, etc.) using its established component patterns, and a normal CSS approach (CSS Modules, Tailwind, styled-components — whatever the project uses). If no codebase exists yet, a static-first React/Next or Astro stack is a good fit for a marketing site.
- `concept_reference.png` is the original visual target. The build matches it closely.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and shadows below are final. Recreate pixel-accurately. The one deliberate deviation from the concept image: the hero photo is a **landscape 3:2 frame with a faded left edge** (see Hero), rather than a tall portrait crop.

---

## Page Structure (single scrolling page)
Container max-width **1180px**, side padding **28px**, centered. Sections in order:

1. Sticky header / nav
2. Hero (two-column)
3. Fundraising band (purple)
4. How It Works (4 steps)
5. Hall of Fame (winner carousel)
6. Stats band (cream)
7. Final CTA band (purple)
8. Footer

---

## Screens / Views

### 1. Header (sticky)
- **Layout:** Sticky top bar, `z-index 50`, background `rgba(255,255,255,0.92)` + `backdrop-filter: blur(10px)`, `border-bottom: 1px solid #efebf5`. Inner row max-width 1180px, padding `14px 28px`, `display:flex; align-items:center; justify-content:space-between`.
- **Logo (left):** Paw-print SVG (38×38, fill `#7c3aed` with top two toes `#a855f7`) + wordmark. Wordmark "PetShow" 25px / 800 / `-0.02em` / `#1c1626`; beneath it "ONLINE" 10px / 700 / letter-spacing `0.32em` / `#9b94a8`.
- **Nav (center):** links — *Why PetShow, How It Works, Events, Categories ▾, Pricing, Hall of Fame*. 15px / 600 / `#4a4357`, `gap: 30px`. Categories has a chevron.
- **Actions (right):** **Log In** — text `#7c3aed` 700, `1.5px solid #e6dcfb` border, radius 11px, padding `9px 18px`. **Sign Up** — white text on `#7c3aed`, radius 11px, padding `10px 20px`, shadow `0 6px 16px rgba(124,58,237,0.32)`.

### 2. Hero
- **Layout:** Grid `grid-template-columns: 0.9fr 1.18fr; gap: 40px; align-items:center`, padding `54px 28px 28px`.
- **Left column:**
  - Eyebrow pill: "More Fun. More Paws. More Purpose." — bg `#f1eafe`, text `#7c3aed` 700/13.5px, radius 99px, padding `8px 15px`, leading coral heart icon (`#f0518a`).
  - H1: "Virtual Pet Shows." (color `#1c1626`) line break "Real Impact." (color `#7c3aed`). 55px / 800 / line-height 1.04 / letter-spacing `-0.03em`.
  - Lead paragraph: 18px / line-height 1.62 / `#5d566b`, max-width 430px. Copy: *"PetShow Online makes it easy to run virtual dog shows and pet competitions that bring communities together and raise money for the causes you care about."*
  - CTAs: **Create a Show** (primary) — white on `#7c3aed`, 16px/700, padding `15px 26px`, radius 13px, shadow `0 10px 24px rgba(124,58,237,0.3)`, leading calendar icon. **Browse Events** (secondary) — `#7c3aed` text on white, `1.5px solid #e6dcfb`, leading paw icon.
  - Three mini-features (flex, wrap, gap 26px). Each = 38×38 rounded-11px icon chip + title (14.5px/700) + caption (12.5px/`#7d7689`):
    - **Great for Fundraisers** — chip `#ffe4ee`, coral heart icon. "Raise more with our easy fundraising tools"
    - **Easy to Run** — chip `#d6f5f0`, teal paw icon (`#0d9488`). "Simple setup. We handle the rest."
    - **Fair & Fun** — chip `#dcf6e3`, green shield-check (`#16a34a`). "Anonymous judging for fair, unbiased results"
- **Right column (hero image):**
  - Frame: `position:relative; width:100%; aspect-ratio: 3/2; overflow:hidden; border-radius: 0 24px 24px 0` (square left corners), `box-shadow: 18px 26px 54px rgba(124,58,237,0.16)`, background `#fff`. Holds a user-supplied pet photo, `object-fit: contain` so the full image shows uncropped.
  - **Left-fade overlay:** absolutely positioned `inset:0; pointer-events:none`, `background: linear-gradient(90deg, #ffffff 0%, rgba(255,255,255,0.85) 14%, rgba(255,255,255,0) 38%)`. Blends the photo's left edge into the page.
  - **Floating decorations** (subtle gentle float animation, ~4.5–6s ease-in-out, disabled under `prefers-reduced-motion`): coral heart top-right, small purple heart bottom-right, plus amber/teal 11–13px rounded confetti squares.
  - **"Perfect for:" card** — floats over the faded left zone: `position:absolute; left:-22px; top:50%; transform:translateY(-50%)`, width 234px, bg `#fffdf7`, radius 18px, padding `18px 20px`, `border:1px solid #f3eee2`, shadow `0 18px 44px rgba(28,22,38,0.18)`. Header "Perfect for:" (15px/800) with coral heart. Five rows (13.5px/600/`#403a4d`), each a purple check-in-circle (`#7c3aed` circle, white check) + label: *Charity Fundraisers, Community Events, Shelter Support, Special Occasions, Fun Competitions*. Footer accent in **Caveat** handwriting font, 21px/700/`#7c3aed`: *"Big hearts. Happy pets. Stronger communities."*

### 3. Fundraising Band
- Full-width section (max-width 1180px). Card: `background: linear-gradient(120deg, #6d28d9, #5b21b6)`, radius 22px, padding `30px 36px`, flex row, `gap 26px`, `overflow:hidden`. Faint white paw watermark (`opacity 0.12`) top-right.
- Left: 62×62 rounded-17px tile `rgba(255,255,255,0.16)` with white hands-holding-heart icon (heart fill `#f0a4d0`).
- Middle: title "Fundraise while having fun!" 22px/800/white; body 15px/`#e3d8fb`: *"Keep more of what you raise. We charge a small platform fee so you can focus on making a big difference."*
- Right: button "Learn More About Fundraising ›" — white bg, `#6d28d9` text, 15px/700, radius 12px, padding `14px 22px`.

### 4. How It Works
- Section max-width **1080px**, padding `74px 28px 64px`.
- Centered H2 "How PetShow Online Works" 34px/800/`-0.02em`, with a 64×4px `#7c3aed` rounded underline below (margin auto).
- 4-step grid `repeat(4,1fr); gap:18px`. A **dashed connector line** sits behind the icon row: absolutely positioned `top:38px; left:12.5%; right:12.5%; border-top:2px dashed #d9d2e8` (endpoints tuck under the opaque icon circles).
- Each step (centered column): 76×76 circle (tinted bg) with line icon, then a row of a 22px dark-purple (`#2e1065`) numbered badge + title (16px/800), then caption (14px/1.55/`#6f6880`, max-width 200px):
  1. **Create Your Show** — circle `#efe7fd`, calendar icon `#7c3aed`. "Set up your event in minutes. Add categories, dates and your cause."
  2. **Participants Enter** — circle `#ffe4ee`, cloud-upload `#f0518a`. "Your community enters, pays securely and submits photos or videos."
  3. **Judging Happens** — circle `#fef1d6`, trophy `#e89b1c`. "Judges score entries anonymously for a fair and unbiased competition."
  4. **Celebrate & Raise** — circle `#dcf6e3`, party-popper `#16a34a`. "Winners are announced and funds raised go to your cause!"

### 5. Hall of Fame
- Section max-width 1180px. Panel: bg `#f4effd`, radius 26px, grid `280px 1fr`, gap 24px, padding `38px 0 38px 40px`.
- Left: H2 "Hall of Fame" 32px/800, 56×4px `#7c3aed` underline, body 15px/`#6f6880` ("Celebrating amazing pets and the people who love them."), **View All Winners** button (white, `#7c3aed` text, `1.5px #e6dcfb` border, radius 12px) with paw icon.
- Right: horizontally-scrollable rail (`display:flex; gap:18px; overflow-x:auto`, hidden scrollbar). A circular **next** button (44px, white, `box-shadow 0 8px 20px rgba(28,22,38,0.14)`) overlaps the right edge and scrolls the rail by ~320px.
- **Winner card** (180px wide, white, radius 18px, shadow `0 8px 22px rgba(28,22,38,0.07)`): 180px photo area (top corners rounded) with a 34px circular **rank-ribbon medal** top-left (gold `#fbbf24` / silver `#c0c6d0` / bronze `#d99659` / `#cf8a4f`) holding a white ribbon icon. Below: name (16px/800), category (13px/600/`#7c3aed`), event (12px/`#9b94a8`). Seed data: **Buddy** · Best Dressed · Spring Paws Show 2024 / **Luna** · Waggiest Tail · Paws for a Cause 2024 / **Charlie** · Cutest Pup · Love Rescues Event 2024 / **Cooper** · Best Personality · Community Paws 2024.

### 6. Stats Band
- Section max-width 1180px. Panel bg `#fdf3da` (cream), radius 26px, padding `34px 40px`, grid `auto 1fr auto`, gap 34px, `align-items:center`.
- Left: 84×84 purple heart-with-paw icon (heart `#7c3aed`, paw cut-out white).
- Middle: title "Built for pet lovers and causes that matter." 21px/800/`#7c3aed`; body 14px/`#6f6880`: *"From local fundraisers to special events, PetShow Online helps you create memorable experiences and make a real impact."*
- Right: 4 stats (flex, gap 36px). Numbers 34px/800/`#7c3aed`/`-0.02em`; labels 13px/600/`#7d7689`: **2,500+** Shows Created · **150K+** Happy Participants · **$1.8M+** Raised for Charity · **100%** Pet Lover Approved.

### 7. Final CTA Band
- Section max-width 1180px. Card `background: linear-gradient(120deg, #7c3aed, #6d28d9)`, radius 22px, padding `30px 38px`, flex row space-between, `overflow:hidden`, faint white paw watermark bottom-left (`opacity 0.1`).
- Left: "Ready to create something amazing?" 24px/800/white; sub 15px/`#e3d8fb`: "Start your virtual pet show today and turn fun into impact."
- Right: **Get Started Free** (white bg, `#6d28d9` text, radius 12px) + **How It Works** (transparent, white text, `1.5px rgba(255,255,255,0.5)` border, play icon).

### 8. Footer
- Section max-width 1180px, padding `60px 28px 40px`. Grid `1.6fr 1fr 1fr 1fr 1fr`, gap 30px.
- Brand cell: logo + wordmark (smaller, 21px) + blurb 14px/`#6f6880`: "The leading platform for virtual pet shows, competitions and fundraising events."
- Link columns (heading 14px/800; links 14px/500/`#6f6880`, gap 10px):
  - **Explore:** Events, Categories, Hall of Fame, How It Works
  - **Support:** Help Center, Contact Us, Terms of Service, Privacy Policy
  - **For Organisers:** Create a Show, Fundraising Tools, Pricing, Resources
  - **Stay Connected:** four 38px round social buttons (bg `#f1eafe`, `#7c3aed` glyphs) — Facebook, Instagram, TikTok, Email.
- Bottom: `border-top: 1px solid #efebf5`, margin-top 34px, padding-top 22px, "© 2024 PetShow Online. All rights reserved." 13px/`#9b94a8`.

---

## Interactions & Behavior
- **Sticky header** stays pinned with a blurred translucent background on scroll.
- **Nav links** are anchor links to in-page section ids (`#why`, `#how`, `#events`, `#categories`, `#pricing`, `#hof`) with `scroll-behavior: smooth`. Wire to real routes/sections in production.
- **Hall of Fame "next" button** scrolls the rail right by ~320px (`scrollBy({left:320, behavior:'smooth'})`). Add a matching prev button + keyboard/touch support in production; consider showing arrows only when overflow exists.
- **Floating hero decorations** use a gentle vertical float (`@keyframes`, 4.5–6s, ease-in-out, infinite). **Must be disabled** under `prefers-reduced-motion: reduce`.
- **Hover states** (not in the prototype — add per your design system): buttons darken ~6–8% and lift ~1px; nav links tint to `#7c3aed`; cards lift with a deeper shadow.
- **Responsive:** below ~900px the hero grid and the Stats/Fundraising/CTA bands should stack to a single column; the How-It-Works 4-up becomes 2-up then 1-up (drop the dashed connector when stacked); footer grid collapses to 2 cols then 1; nav collapses to a hamburger with a slide-in panel (hit targets ≥44px).

## State Management
The page is essentially static marketing content. The only interactive state:
- **Carousel scroll position** (Hall of Fame rail) — local/ref state; no persistence needed.
- **Mobile nav open/closed** — to be added.
- Auth/links (Log In, Sign Up, Create a Show) are entry points to flows that live outside this page.

## Design Tokens

### Color — Brand
| Token | Hex |
|---|---|
| Purple (primary) | `#7c3aed` |
| Purple Dark | `#6d28d9` |
| Purple Deep (gradient end / badges) | `#5b21b6` / `#2e1065` |
| Purple Light | `#a855f7` |
| Coral / Pink | `#f0518a` (accent `#f0a4d0`) |
| Teal | `#0d9488` (accent `#2dd4bf`) |
| Green | `#16a34a` |
| Amber / Gold | `#fbbf24` / `#e89b1c` |

### Color — Tints & surfaces
Purple tint `#f1eafe` / `#efe7fd` · Pink tint `#ffe4ee` · Teal tint `#d6f5f0` · Green tint `#dcf6e3` · Amber tint `#fef1d6` · Hall-of-Fame panel `#f4effd` · Stats panel cream `#fdf3da` · Card cream `#fffdf7` · Border `#efebf5` / `#e6dcfb` / `#f3eee2`.

### Color — Text
Heading/near-black `#1c1626` · Nav text `#4a4357` · Body `#5d566b` · Muted `#6f6880` / `#7d7689` · Subtle `#9b94a8`.

### Typography
- **Plus Jakarta Sans** (Google Fonts; weights 400/500/600/700/800, plus italic 500/600) — all headings, UI, and body.
- **Caveat** (Google Fonts; 600/700) — handwritten accent only (the "Big hearts…" line). Use sparingly.
- Scale: H1 55/800, section H2 32–34/800, card titles 16/800, body 14–18/400–500, captions 12–13.5, eyebrow/labels 13–15/600–700.

### Radius
Buttons 11–13px · Cards/panels 18–26px · Pills 99px · Icon chips 11–17px.

### Shadow
Buttons (primary) `0 10px 24px rgba(124,58,237,0.3)` · Floating card `0 18px 44px rgba(28,22,38,0.18)` · Hero frame `18px 26px 54px rgba(124,58,237,0.16)` · Winner card `0 8px 22px rgba(28,22,38,0.07)`.

### Spacing
Container max 1180px (How-It-Works 1080px), side padding 28px. Band/panel inner padding ~30–40px. Section vertical rhythm ~28–74px.

## Assets
- **Icons** are all inline SVG (paw, heart, calendar, cloud-upload, trophy, party-popper, shield-check, hands-heart, ribbon, social glyphs, chevron, play, check). Replace with your icon library (e.g. Lucide/Phosphor) or keep as inline SVG.
- **Photography is user-supplied.** The prototype uses drop-in image placeholders (`image-slot.js`) for the hero and the four Hall-of-Fame winner photos. In production these become normal `<img>`/`next/image` slots fed by a CMS. The hero expects a roughly **3:2 landscape** photo, shown `object-fit: contain` with a left-edge fade.
- No third-party brand assets are used. The PetShow paw logo is a simple inline SVG wordmark — replace once the real brand is finalized.

## Files
- `PetShow Online.dc.html` — the high-fidelity design reference (read as a visual spec; do not port the DC runtime).
- `image-slot.js` — the prototype's drag-and-drop image placeholder component (prototype-only; not for production).
- `concept_reference.png` — the original concept image this page was built to match.
