import { mount } from 'svelte';
import './styles.css';
import App from './app/App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Application mount target was not found.');

const app = mount(App, { target });
export default app;
