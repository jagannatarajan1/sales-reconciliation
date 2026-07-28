import './ui.css';

export const Skeleton = ({ width = '100%', height = '1rem', className = '', style = {} }) => (
  <span
    className={`ui-skeleton ${className}`}
    style={{ display: 'block', width, height, ...style }}
    aria-hidden="true"
  />
);
