import { CallbackHandler } from 'langfuse-langchain';
import type { ISupplyDataFunctions } from 'n8n-workflow';

export class N8nLangfuse extends CallbackHandler {
    constructor(private ctx: ISupplyDataFunctions, params: {
        publicKey: string;
        secretKey: string;
        host: string;
        sessionId?: string;
    }) {
        super({
            publicKey: params.publicKey,
            secretKey: params.secretKey,
            baseUrl: params.host,
            sessionId: params.sessionId,
        });
    }
}
