import { motion } from 'framer-motion';
import './ui.css';

export const Card = ({ children, accent, hoverable = true, className = '', style = {}, ...rest }) => (
  <motion.div
    className={`ui-card ${className}`}
    style={{ ...style, '--ui-card-accent': accent }}
    whileHover={hoverable ? { y: -6, boxShadow: 'var(--shadow-lg)' } : undefined}
    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    {...rest}
  >
    {children}
  </motion.div>
);
