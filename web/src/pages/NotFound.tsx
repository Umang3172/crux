import { Link } from "react-router";

export default function NotFound() {
  return (
    <section style={{ display: "grid", gap: "var(--space-3)", maxWidth: 560 }}>
      <h1 style={{ fontSize: "var(--step-3)" }}>Nothing here</h1>
      <p style={{ color: "var(--ink-2)" }}>This link doesn't lead to a page of this demo.</p>
      <p>
        <Link to="/">Back to the plant</Link>
      </p>
    </section>
  );
}
