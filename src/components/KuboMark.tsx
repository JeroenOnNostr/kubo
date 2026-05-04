import { cn } from '@/lib/utils';

interface KuboMarkProps {
  size?: number;
  className?: string;
}

export function KuboMark({ size = 48, className }: KuboMarkProps) {
  return (
    <img
      src="/logo-color.svg"
      alt=""
      width={size}
      height={size}
      className={cn('block', className)}
    />
  );
}
