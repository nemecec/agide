import { contextBridge, ipcRenderer } from 'electron';
import { createAppearanceApi } from '../shared/appearanceIpc';
import { createRendererApi } from '../shared/rendererApi';

contextBridge.exposeInMainWorld('api', createRendererApi(ipcRenderer));
contextBridge.exposeInMainWorld('appearance', createAppearanceApi(ipcRenderer));
