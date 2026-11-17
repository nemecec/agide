import { contextBridge, ipcRenderer } from 'electron';
import { createRendererApi } from '../shared/rendererApi';

contextBridge.exposeInMainWorld('api', createRendererApi(ipcRenderer));
