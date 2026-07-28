import './ui.css';

export const Badge = ({ children, variant = 'neutral', className = '' }) => (
  <span className={`ui-badge ui-badge--${variant} ${className}`}>{children}</span>
);
