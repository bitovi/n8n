import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class LangfuseApi implements ICredentialType {
    name = 'langfuseApi';
    displayName = 'Langfuse';
    documentationUrl = 'langfuse';
    properties: INodeProperties[] = [
        {
            displayName: 'Public Key',
            name: 'publicKey',
            type: 'string',
            required: true,
            default: '',
        },
        {
            displayName: 'Secret Key',
            name: 'secretKey',
            type: 'string',
            typeOptions: { password: true },
            required: true,
            default: '',
        },
        {
            displayName: 'Host',
            name: 'host',
            type: 'string',
            default: 'https://app.langfuse.com',
        },
    ];
}
