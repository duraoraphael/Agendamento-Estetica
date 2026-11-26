/**
 * Preço de um serviço na vitrine. `label` vem de `priceLabel` (src/lib/pricing.ts): com a cobrança por tipo ligada e o
 * preço variando entre as categorias, mostra "A partir de" acima do menor valor; senão, só o valor padrão.
 */
export function ServicePrice({ label, className = "" }: { label: { text: string; prefix: string | null }; className?: string }) {
  return (
    <span className={`inline-block text-right ${className}`}>
      {label.prefix && <span className="block text-[0.65rem] font-semibold uppercase leading-tight tracking-wider opacity-80">{label.prefix}</span>}
      <span className="whitespace-nowrap tabular-nums">{label.text}</span>
    </span>
  );
}
