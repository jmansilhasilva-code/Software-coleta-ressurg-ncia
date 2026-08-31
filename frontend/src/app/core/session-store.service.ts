import { Injectable } from '@angular/core';

import { ClientConfig } from './models';

/** Guarda a configuração da sessão atual entre a tela do operador e o experimento. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  config: ClientConfig | null = null;
  devMode = false;
  /** true quando o backend não respondeu na criação (fallback local). */
  offline = false;
}
