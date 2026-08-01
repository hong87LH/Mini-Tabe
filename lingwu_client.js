import { fetchWithRetry, fetchWithTimeout, NetworkStageError } from './network_utils.js';


export class LingwuClient {
  constructor(apiKey, endpoint) {
    this.apiKey = apiKey;
    this.endpoint = endpoint || 'https://api.lingwu.example.com';
    this.endpoint = this.endpoint.replace(/\/+$/, '');
  }

  async createTask(model, prompt, params, count = 1) {
    try {
      const res = await fetchWithTimeout({
        url: `${this.endpoint}/v1/media/generate`,
        options: {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            prompt,
            params,
            count
          })
        },
        timeoutMs: 120000
      });
      
      if (!res.ok) {
         let errorDetails = '';
         try {
           errorDetails = await res.text();
         } catch(e) {}
         
         const submissionUnknown = res.status >= 500 || res.status === 429 || res.status === 408;
         throw new NetworkStageError(`HTTP Error ${res.status}`, {
            stage: 'create',
            code: `HTTP_${res.status}`,
            httpStatus: res.status,
            retryable: submissionUnknown,
            submissionUnknown: submissionUnknown,
            details: errorDetails
         });
      }
      return await res.json();
    } catch (error) {
      if (error instanceof NetworkStageError) {
        throw error;
      }
      
      const isConnectionLost = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.name === 'AbortError' || error.message.includes('fetch');
      throw new NetworkStageError(error.message, {
        stage: 'create',
        code: 'CREATE_SUBMISSION_UNKNOWN',
        retryable: false,
        submissionUnknown: isConnectionLost
      });
    }
  }

  async queryStatusPath({ path, taskId }) {
    const url = new URL(`${this.endpoint}${path}`);
    url.searchParams.set('task_id', taskId);
    
    return fetchWithRetry({
      url: url.toString(),
      options: {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      },
      stage: 'status_query',
      timeoutMs: 30000
    });
  }

  async getTaskStatus(taskId) {
    const primaryRes = await this.queryStatusPath({
      path: '/v1/media/status',
      taskId
    });

    if (primaryRes.status !== 404 && primaryRes.status !== 405) {
      if (!primaryRes.ok) throw new Error(`HTTP Error ${primaryRes.status}`);
      return primaryRes.json();
    }

    const fbRes = await this.queryStatusPath({
      path: '/v1/skills/task-status',
      taskId
    });

    if (!fbRes.ok) throw new Error(`Fallback HTTP Error ${fbRes.status}`);
    return fbRes.json();
  }
}
