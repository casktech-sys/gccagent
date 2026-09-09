/** Design tokens for the Warrant console.
 *
 *  Register: warm paper stock, hairline rules, serif titles — a printed
 *  instrument rather than a dashboard. Colour carries meaning and nothing else:
 *  brass is human authority, so escalation, approval and the accent are one
 *  colour rather than three.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "#F6F2E9",     // page: warm paper
        surface: "#FFFDF8",    // panels, a shade lighter than the page
        raise: "#EDE7DA",      // inputs and nested fills
        rule: "#DED6C6",       // hairlines
        muted: "#6E655A",      // secondary text
        ink: "#211D17",        // primary text, warm near-black
        brass: "#8A6A12",      // human authority: escalation, approval, accent
        verdigris: "#2E6A50",  // allowed by the rules
        rust: "#A33324",       // stopped, refused, hard limit
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Archivo", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      fontSize: {
        micro: ["0.75rem", { lineHeight: "1.15rem" }],
        small: ["0.8125rem", { lineHeight: "1.3rem" }],
        base: ["0.9375rem", { lineHeight: "1.6rem" }],
        lead: ["1.125rem", { lineHeight: "1.7rem" }],
        title: ["1.5rem", { lineHeight: "1.9rem", letterSpacing: "-0.01em" }],
        display: ["2.5rem", { lineHeight: "2.7rem", letterSpacing: "-0.02em" }],
      },
      borderRadius: { sm: "2px", DEFAULT: "3px", md: "4px" },
      maxWidth: { measure: "68ch" },
      boxShadow: {
        // One soft lift, used only for things floating above the page.
        lift: "0 2px 4px rgb(33 29 23 / 0.04), 0 12px 32px rgb(33 29 23 / 0.10)",
      },
    },
  },
  plugins: [],
};
