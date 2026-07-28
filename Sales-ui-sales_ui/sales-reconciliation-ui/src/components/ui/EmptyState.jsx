import './ui.css';

export const EmptyState = ({ icon, title, description, action = null }) => (
  <div className="ui-empty">
    {icon ? <div className="ui-empty__icon">{icon}</div> : null}
    <div className="ui-empty__title">{title}</div>
    {description ? <div className="ui-empty__desc">{description}</div> : null}
    {action}
  </div>
);
