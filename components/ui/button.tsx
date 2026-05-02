"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:  "bg-brand-500 text-white shadow-md hover:bg-brand-600",
        outline:  "border-2 border-brand-500 text-brand-600 bg-transparent hover:bg-brand-50",
        ghost:    "text-brand-600 hover:bg-brand-50",
        danger:   "bg-red-500 text-white hover:bg-red-600",
        secondary:"bg-gray-100 text-gray-800 hover:bg-gray-200",
        white:    "bg-white text-brand-600 shadow hover:bg-brand-50",
      },
      size: {
        sm:  "h-8 px-3 text-xs",
        md:  "h-10 px-4",
        lg:  "h-12 px-6 text-base",
        xl:  "h-14 px-8 text-lg",
        icon:"h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
