import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:   "bg-brand-100 text-brand-700",
        secondary: "bg-gray-100 text-gray-700",
        success:   "bg-green-100 text-green-700",
        warning:   "bg-yellow-100 text-yellow-700",
        danger:    "bg-red-100 text-red-700",
        dupr:      "bg-brand-500 text-white font-bold",
        outline:   "border border-brand-500 text-brand-600",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
