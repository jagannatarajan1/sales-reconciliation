import { motion } from 'framer-motion';
import './ui.css';

export const Button = ({
  children,
  variant = 'primary',
  loading = false,
  icon = null,
  disabled = false,
  type = 'button',
  className = '',
  onClick,
  ...rest
}) => (
  <motion.button
    type={type}
    className={`ui-btn ui-btn--${variant} ${className}`}
    disabled={disabled || loading}
    onClick={onClick}
    whileHover={disabled || loading ? undefined : { scale: 1.02 }}
    whileTap={disabled || loading ? undefined : { scale: 0.97 }}
    transition={{ duration: 0.15 }}
    {...rest}
  >
    {loading ? <span className="ui-btn__spinner" aria-hidden="true" /> : icon}
    {children}
  </motion.button>
);
