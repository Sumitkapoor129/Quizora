/** Original CSS motion graphic. Decorative and independent of application state. */
export function OrbitGraphic() {
  return (
    <div className="orbit-graphic" aria-hidden="true">
      <div className="orbit-graphic__grid" />
      <div className="orbit-graphic__ring orbit-graphic__ring--outer"><i /></div>
      <div className="orbit-graphic__ring orbit-graphic__ring--middle"><i /></div>
      <div className="orbit-graphic__ring orbit-graphic__ring--inner"><i /></div>
      <div className="orbit-graphic__core">Q<span /></div>
      <div className="orbit-graphic__tag orbit-graphic__tag--top"><span>✦</span> A little progress, every day.</div>
      <div className="orbit-graphic__tag orbit-graphic__tag--bottom"><span>✓</span> Built for your next breakthrough</div>
    </div>
  );
}
