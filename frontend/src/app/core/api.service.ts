import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  EventLog,
  SessionCreatePayload,
  SessionCreateResponse,
} from './models';

/**
 * Base da API. Usa o mesmo host da página na porta 8000 — assim funciona tanto
 * em localhost quanto ao acessar de um celular pelo IP da máquina na rede local.
 */
function apiBase(): string {
  const host = typeof location !== 'undefined' ? location.hostname : 'localhost';
  return `http://${host}:8000/api`;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = apiBase();

  constructor(private http: HttpClient) {}

  createSession(payload: SessionCreatePayload): Observable<SessionCreateResponse> {
    return this.http.post<SessionCreateResponse>(`${this.base}/sessions/`, payload);
  }

  patchSession(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.patch(`${this.base}/sessions/${id}/`, body);
  }

  uploadEvents(id: string, events: EventLog[]): Observable<unknown> {
    return this.http.post(`${this.base}/sessions/${id}/events/`, { events });
  }
}
