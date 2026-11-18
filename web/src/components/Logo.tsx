/** Logo InteliSUS em blocos: "inteli" + S U S (verde, amarelo, branco/azul). */
export function Logo({ mini = false }: { mini?: boolean }) {
  return (
    <div className={`logo ${mini ? 'mini' : ''}`} role="img" aria-label="InteliSUS">
      {!mini && <div className="logo-w">inteli</div>}
      <div className="logo-r"><i className="t1">S</i><i className="t2">U</i><i className="t3">S</i></div>
    </div>
  );
}
