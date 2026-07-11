// Плавающий label-инпут (компонент из макета пользователя).
// В vanilla-версии реализован CSS-классами .ff / .ff-input / .ff-label.
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";

const EASE_IN_OUT_CUBIC_X1 = 0.4;
const EASE_IN_OUT_CUBIC_Y1 = 0;
const EASE_IN_OUT_CUBIC_X2 = 0.2;
const EASE_IN_OUT_CUBIC_Y2 = 1;
const RADIX_BASE_36 = 36;
const RANDOM_ID_START_INDEX = 2;
const RANDOM_ID_LENGTH = 9;

const LABEL_TRANSITION = {
  duration: 0.28,
  ease: [
    EASE_IN_OUT_CUBIC_X1,
    EASE_IN_OUT_CUBIC_Y1,
    EASE_IN_OUT_CUBIC_X2,
    EASE_IN_OUT_CUBIC_Y2,
  ] as [number, number, number, number],
};

export interface AnimatedInputProps {
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  inputClassName?: string;
  label: string;
  labelClassName?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
}

export default function AnimatedInput({
  value,
  defaultValue = "",
  onChange,
  label,
  placeholder = "",
  disabled = false,
  className = "",
  inputClassName = "",
  labelClassName = "",
  icon,
  type = "text",
}: AnimatedInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const val = isControlled ? value : internalValue;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const isFloating = !!val || isFocused;
  const shouldReduceMotion = useReducedMotion();
  const inputId = `animated-input-${Math.random().toString(RADIX_BASE_36).substring(RANDOM_ID_START_INDEX, RANDOM_ID_LENGTH)}`;

  const getLabelAnimation = () => {
    if (shouldReduceMotion) return {};
    if (isFloating) {
      return {
        y: -24,
        scale: 0.85,
        // цвет из дизайн-системы disbit вместо --color-brand
        color: "var(--primary)",
        borderColor: "var(--primary)",
      };
    }
    return { y: 0, scale: 1, color: "var(--text-3)" };
  };

  const getLabelStyle = () => {
    if (!shouldReduceMotion) return {};
    if (isFloating) {
      return {
        transform: "translateY(-24px) scale(0.85)",
        color: "var(--primary)",
        borderColor: "var(--primary)",
      };
    }
    return { transform: "translateY(0) scale(1)", color: "var(--text-3)" };
  };

  return (
    <div className={`ff ${className}`} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      {icon && (
        <span aria-hidden="true" style={{ position: "absolute", left: 12 }}>
          {icon}
        </span>
      )}
      <input
        aria-label={label}
        className={`ff-input ${inputClassName}`}
        disabled={disabled}
        id={inputId}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => {
          if (!isControlled) setInternalValue(e.target.value);
          onChange?.(e.target.value);
        }}
        onFocus={() => setIsFocused(true)}
        placeholder={isFloating ? placeholder : ""}
        ref={inputRef}
        style={icon ? { paddingLeft: 40 } : undefined}
        type={type}
        value={val}
      />
      <motion.label
        animate={getLabelAnimation()}
        className={labelClassName}
        htmlFor={inputId}
        style={{
          position: "absolute",
          left: 12,
          zIndex: 2,
          pointerEvents: "none",
          transformOrigin: "left center",
          background: "var(--sheet-bg, var(--bg))",
          padding: "0 6px",
          borderRadius: 6,
          ...getLabelStyle(),
        }}
        transition={shouldReduceMotion ? { duration: 0 } : LABEL_TRANSITION}
      >
        {label}
      </motion.label>
    </div>
  );
}
