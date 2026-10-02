import { createRoot } from 'react-dom/client';
import { assessmentApi } from './adapters/outbound/http/api.js';
import { App } from './adapters/inbound/react/App.js';
import './adapters/inbound/react/styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Application root is missing');
}
createRoot(root).render(<App api={assessmentApi} />);
