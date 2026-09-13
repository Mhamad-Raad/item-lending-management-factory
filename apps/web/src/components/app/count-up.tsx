import { MoneyText } from './money-text';
import { QuantityText } from './quantity-text';
import { useCountUp } from '@/hooks/use-count-up';

/** A dashboard figure that counts up to its value (§7.5, §7.14). */
export function CountUp({ value, format }: { value: number; format: 'money' | 'number' }) {
  const shown = useCountUp(value);
  return format === 'money' ? <MoneyText value={shown} /> : <QuantityText value={shown} />;
}
