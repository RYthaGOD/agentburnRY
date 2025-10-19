# Design Guidelines: Solana Buy Back & Burn SaaS Platform

## Design Approach

**Hybrid Approach:** Marketing pages draw from modern crypto/SaaS leaders (Phantom, Uniswap, Linear) while dashboard follows a systematic utility-focused design for clarity and efficiency.

**Key Principles:**
- Trust & credibility through professional polish
- Crypto-native dark aesthetic with strategic color accents
- Clear data hierarchy for transaction monitoring
- Seamless wallet integration patterns

---

## Core Design Elements

### A. Color Palette

**Dark Mode Primary (Default):**
- Background Base: 222 15% 8%
- Surface: 222 15% 12%
- Surface Elevated: 222 15% 16%
- Border Subtle: 222 10% 20%
- Border: 222 10% 28%

**Light Mode (Optional Toggle):**
- Background: 0 0% 98%
- Surface: 0 0% 100%
- Border: 220 10% 88%

**Brand Colors:**
- Primary (Solana-inspired Purple): 270 75% 62%
- Primary Dark: 270 75% 55%
- Success (Burn confirmation): 142 76% 45%
- Warning (Pending actions): 38 92% 50%
- Error: 0 72% 55%

**Accent:**
- Electric Blue for CTAs: 210 100% 58%
- Chart/Graph accent: 170 80% 50%

### B. Typography

**Fonts (via Google Fonts):**
- Primary: 'Inter' - clean, modern, excellent readability
- Mono (for addresses/hashes): 'JetBrains Mono'

**Scale:**
- Hero Headline: 3.5rem (56px) / bold / -0.02em
- Section Headline: 2.25rem (36px) / semibold
- Dashboard Title: 1.875rem (30px) / semibold
- Body Large: 1.125rem (18px) / normal
- Body: 1rem (16px) / normal
- Caption/Labels: 0.875rem (14px) / medium
- Mono (addresses): 0.875rem / 500

### C. Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24
- Micro spacing: p-2, gap-2 (component internals)
- Component spacing: p-4, gap-4 (cards, buttons)
- Section padding: py-12 md:py-20 (landing sections)
- Container spacing: px-6 lg:px-8
- Large gaps: gap-8, gap-12 (between major sections)

**Grid System:**
- Landing: max-w-7xl container
- Dashboard: Full-width with max-w-[1600px]
- Content: max-w-prose for text-heavy areas

### D. Component Library

**Navigation:**
- Sticky header with blur backdrop (backdrop-blur-xl bg-background/80)
- Logo left, nav center/right, wallet connect button prominent
- Mobile: hamburger menu with full-screen overlay

**Buttons:**
- Primary: Electric blue gradient with hover lift
- Secondary: outline with border
- Ghost: transparent hover state
- Wallet connect: distinctive purple gradient

**Cards:**
- Dashboard cards: subtle border, elevated on hover
- Feature cards: gradient borders on dark backgrounds
- Transaction cards: compact with status indicators

**Forms:**
- Floating labels or clear top labels
- Input backgrounds slightly elevated from surface
- Focus states with primary color ring
- Validation states with color-coded borders

**Data Displays:**
- Transaction table: alternating row backgrounds
- Status badges: colored with appropriate icons
- Charts: minimal grid lines, bold data lines
- Token amounts: mono font with 4-6 decimal precision

**Navigation Tabs (Dashboard):**
- Underline style with smooth animation
- Active state with primary color

**Overlays:**
- Modals: centered, backdrop blur with dark overlay
- Toasts: top-right, auto-dismiss with progress bar
- Wallet connection: modal with provider options

### E. Animations

**Strategic Use Only:**
- Button hover: subtle scale (1.02) and shadow increase
- Card hover: gentle lift with shadow
- Page transitions: fade (150ms)
- Success states: checkmark animation on burn completion
- NO scroll-triggered animations on dashboard
- Hero section: subtle gradient shift on landing page only

---

## Page-Specific Guidelines

### Landing Page

**Hero Section (80vh):**
- Large headline emphasizing "Automated" and "Plug & Play"
- Sub-headline explaining value proposition
- Dual CTAs: "Get Started" (primary) + "View Pricing" (secondary)
- Hero visual: Abstract Solana-themed background with floating token icons or network visualization
- Trust indicators below: "No coding required • Secure • Transparent"

**Features Section:**
- 3-column grid (1 col mobile, 3 col desktop)
- Icon + title + description format
- Icons from Heroicons (outline style)
- Each feature card with subtle gradient border

**How It Works:**
- 4-step process in numbered cards
- Alternating left/right layout on desktop
- Visual flow indicators between steps

**Pricing Tiers:**
- 2-tier card layout (Starter/Pro)
- Highlighted recommended tier with badge
- Clear feature comparison
- Solana SOL payment integration (treasury wallet)

**Social Proof:**
- Transaction stats: Total burned, Total value, Active users
- Displayed in large numbers with supporting text
- Animated counter effect optional

**Footer:**
- Multi-column: Company, Resources, Social, Newsletter
- Minimal but complete

### Dashboard Application

**Sidebar Navigation:**
- Collapsed/expanded states
- Icons from Heroicons
- Active page indicator with background + border-left accent

**Configuration Panel:**
- Step-by-step wizard OR single-page form with clear sections
- Token contract input with validation
- Wallet address inputs with copy buttons
- Schedule selector: visual time picker
- Save as draft + Activate buttons

**Monitoring Dashboard:**
- Top row: Key metrics cards (4 columns)
  - Next burn scheduled
  - Total burned
  - Treasury balance  
  - Last transaction status
- Main area: Transaction history table
- Right sidebar: Current configuration summary

**Transaction History:**
- Table with columns: Date/Time, Action, Amount, Tx Hash (truncated), Status
- Status with colored badges
- Click to expand for details
- Pagination at bottom
- Export CSV option

---

## Images

**Hero Image:** Yes - Abstract Solana network visualization or floating SPL token icons with gradient background. Positioned as full-width background with overlay gradient for text readability.

**Feature Icons:** Use Heroicons for consistency - no custom illustrations needed.

**Dashboard:** No decorative images - focus on data clarity and functional UI elements.