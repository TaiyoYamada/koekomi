/** 今どのステップかを点で表す。 */
export function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="dots" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={'d' + (i === current ? ' active' : i < current ? ' done' : '')}
        />
      ))}
    </div>
  )
}
