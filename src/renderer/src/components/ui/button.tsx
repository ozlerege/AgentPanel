import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const variants = {
  default:
    'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary',
  outline:
    'border border-border bg-transparent hover:bg-accent focus-visible:outline-primary',
  ghost: 'hover:bg-accent focus-visible:outline-primary',
  destructive:
    'border border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:outline-destructive'
} as const

export type ButtonVariant = keyof typeof variants

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({
  variant = 'default',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
