/* eslint-disable n8n-nodes-base/node-dirname-against-convention */

import { Ollama } from '@langchain/community/llms/ollama';
import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { getConnectionHintNoticeField } from '@utils/sharedFields';

import { ollamaDescription, ollamaModel, ollamaOptions } from './description';
import { makeN8nLlmFailedAttemptHandler } from '../n8nLlmFailedAttemptHandler';
import { N8nLlmTracing } from '../N8nLlmTracing';
import { N8nLangfuse } from '../N8nLangfuse';

export class LmOllama implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ollama Model',
		// eslint-disable-next-line n8n-nodes-base/node-class-description-name-miscased
		name: 'lmOllama',
		icon: 'file:ollama.svg',
		group: ['transform'],
		version: 1,
		description: 'Language Model Ollama',
		defaults: {
			name: 'Ollama Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Text Completion Models'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmollama/',
					},
				],
			},
		},
		// eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
		inputs: [],
		// eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		...ollamaDescription,
		properties: [
			getConnectionHintNoticeField([NodeConnectionTypes.AiChain, NodeConnectionTypes.AiAgent]),
			ollamaModel,
			ollamaOptions,
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('ollamaApi');

		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as object;

                const callbacks = [new N8nLlmTracing(this)];

                try {
                        const langfuse = await this.getCredentials('langfuseApi', { throwError: false });
                        if (langfuse) {
                                const workflowProxy = this.getWorkflowDataProxy(0);
                                callbacks.push(
                                        new N8nLangfuse(this, {
                                                publicKey: langfuse.publicKey as string,
                                                secretKey: langfuse.secretKey as string,
                                                host: langfuse.host as string,
                                                sessionId: workflowProxy.$workflow.id as string,
                                        }),
                                );
                        }
                } catch {}

                const model = new Ollama({
                        baseUrl: credentials.baseUrl as string,
                        model: modelName,
                        ...options,
                        callbacks,
                        onFailedAttempt: makeN8nLlmFailedAttemptHandler(this),
                });

		return {
			response: model,
		};
	}
}
