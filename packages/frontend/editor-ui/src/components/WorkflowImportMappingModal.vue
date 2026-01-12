<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from '@n8n/i18n';
import { useUIStore } from '@/stores/ui.store';
import { useCredentialsStore, listenForCredentialChanges } from '@/stores/credentials.store';
import { useWorkflowsStore } from '@/stores/workflows.store';
import { nodeViewEventBus } from '@/event-bus';
import { WORKFLOW_IMPORT_MAPPING_MODAL_KEY } from '@/constants';
import { N8nSelect, N8nOption } from '@n8n/design-system';

const props = defineProps<{
	data: {
		workflowData: any;
	};
}>();

const i18n = useI18n();
const uiStore = useUIStore();
const credentialsStore = useCredentialsStore();
const workflowsStore = useWorkflowsStore();

// Wizard state
const currentStep = ref(1);
const NODES_THRESHOLD = 10;

// Available workflows for subworkflow mapping (sorted by last modified)
const availableWorkflows = ref<{ id: string; name: string; updatedAt: number }[]>([]);
const loadingWorkflows = ref(true);

// Track created credentials to update dropdown
const createdCredentials = ref<string[]>([]);

// Listen for new credentials being created
let stopListening: (() => void) | null = null;

onMounted(async () => {
	try {
		const workflows = await workflowsStore.fetchAllWorkflows();
		// Sort by updatedAt descending (most recent first)
		availableWorkflows.value = workflows
			.map((w) => ({
				id: w.id,
				name: w.name,
				updatedAt: new Date(w.updatedAt).getTime(),
			}))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	} catch (error) {
		console.error('Failed to fetch workflows:', error);
	} finally {
		loadingWorkflows.value = false;
	}

	// Listen for credential changes
	stopListening = listenForCredentialChanges({
		store: credentialsStore,
		onCredentialCreated: (credential) => {
			createdCredentials.value.push(credential.id);
		},
	});
});

onUnmounted(() => {
	if (stopListening) {
		stopListening();
	}
});

// Extract nodes from workflow data
const nodes = computed(() => props.data?.workflowData?.nodes || []);

// Determine if wizard mode should be used
const useWizardMode = computed(() => nodes.value.length > NODES_THRESHOLD);

// Total steps for wizard
const totalSteps = computed(() => {
	if (!useWizardMode.value) return 1;
	return 3;
});

// Step titles
const stepTitles = ['Nodes Review', 'Credential Mapping', 'Subworkflow Mapping'];

// Extract unique credential types with their original references
const credentialInfo = computed(() => {
	const credMap = new Map<
		string,
		{ type: string; originalIds: Set<string>; originalNames: Set<string> }
	>();

	nodes.value.forEach((node: any) => {
		if (node.credentials) {
			Object.entries(node.credentials).forEach(([credType, credData]: [string, any]) => {
				if (!credMap.has(credType)) {
					credMap.set(credType, {
						type: credType,
						originalIds: new Set(),
						originalNames: new Set(),
					});
				}
				const info = credMap.get(credType)!;
				if (credData.id) info.originalIds.add(credData.id);
				if (credData.name) info.originalNames.add(credData.name);
			});
		}
	});

	return Array.from(credMap.values());
});

// Extract subworkflow references from executeWorkflow nodes AND agent nodes
const subworkflowInfo = computed(() => {
	const subworkflows: {
		nodeId: string;
		nodeName: string;
		originalId: string;
		originalName: string;
		nodeType: string;
	}[] = [];

	nodes.value.forEach((node: any) => {
		// Standard executeWorkflow nodes
		if (node.type === 'n8n-nodes-base.executeWorkflow') {
			const workflowId = node.parameters?.workflowId;
			if (workflowId) {
				subworkflows.push({
					nodeId: node.id,
					nodeName: node.name,
					originalId: workflowId.value || workflowId,
					originalName: workflowId.cachedResultName || 'Unknown workflow',
					nodeType: 'executeWorkflow',
				});
			}
		}

		// Agent nodes with tool workflow references
		if (node.type?.includes('langchain.agent') || node.type?.includes('langchain.toolWorkflow')) {
			// Check for workflow tool references in agent parameters
			const workflowId = node.parameters?.workflowId;
			if (workflowId) {
				subworkflows.push({
					nodeId: node.id,
					nodeName: node.name,
					originalId: workflowId.value || workflowId,
					originalName: workflowId.cachedResultName || 'Unknown workflow',
					nodeType: 'agent',
				});
			}
		}
	});

	return subworkflows;
});

// Credential mappings: { [credentialType]: selectedCredentialId }
const credentialMappings = reactive<Record<string, string>>({});

// Subworkflow mappings: { [nodeId]: selectedWorkflowId }
const subworkflowMappings = reactive<Record<string, string>>({});

// Get available credentials for a given type (includes newly created ones)
const getAvailableCredentials = (credType: string) => {
	// Force reactivity when new credentials are created
	const _ = createdCredentials.value.length;
	return credentialsStore.getCredentialsByType(credType);
};

// Check if credentials of a given type exist in the current n8n instance
const hasAvailableCredentials = (credType: string) => {
	return getAvailableCredentials(credType).length > 0;
};

// Open credential creation modal
const openCreateCredential = (credType: string) => {
	uiStore.openNewCredential(credType, false);
};

const closeModal = () => {
	uiStore.closeModal(WORKFLOW_IMPORT_MAPPING_MODAL_KEY);
};

// Navigation
const nextStep = () => {
	if (currentStep.value < totalSteps.value) {
		currentStep.value++;
	}
};

const prevStep = () => {
	if (currentStep.value > 1) {
		currentStep.value--;
	}
};

const confirm = () => {
	// Apply mappings to workflow data before importing
	const workflowData = JSON.parse(JSON.stringify(props.data.workflowData));

	if (workflowData.nodes) {
		workflowData.nodes.forEach((node: any) => {
			// Apply credential mappings
			if (node.credentials) {
				Object.keys(node.credentials).forEach((credType) => {
					const mappedCredId = credentialMappings[credType];
					if (mappedCredId && mappedCredId !== '__keep__') {
						const mappedCred = credentialsStore.getCredentialById(mappedCredId);
						if (mappedCred) {
							node.credentials[credType] = {
								id: mappedCred.id,
								name: mappedCred.name,
							};
						}
					}
				});
			}

			// Apply subworkflow mappings for executeWorkflow nodes
			if (node.type === 'n8n-nodes-base.executeWorkflow') {
				const mappedWorkflowId = subworkflowMappings[node.id];
				if (mappedWorkflowId && mappedWorkflowId !== '__keep__') {
					const mappedWorkflow = availableWorkflows.value.find((w) => w.id === mappedWorkflowId);
					if (mappedWorkflow && node.parameters?.workflowId) {
						node.parameters.workflowId = {
							__rl: true,
							value: mappedWorkflow.id,
							mode: 'list',
							cachedResultName: mappedWorkflow.name,
							cachedResultUrl: `/workflow/${mappedWorkflow.id}`,
						};
					}
				}
			}

			// Apply subworkflow mappings for agent nodes
			if (node.type?.includes('langchain.agent') || node.type?.includes('langchain.toolWorkflow')) {
				const mappedWorkflowId = subworkflowMappings[node.id];
				if (mappedWorkflowId && mappedWorkflowId !== '__keep__') {
					const mappedWorkflow = availableWorkflows.value.find((w) => w.id === mappedWorkflowId);
					if (mappedWorkflow && node.parameters?.workflowId) {
						node.parameters.workflowId = {
							__rl: true,
							value: mappedWorkflow.id,
							mode: 'list',
							cachedResultName: mappedWorkflow.name,
							cachedResultUrl: `/workflow/${mappedWorkflow.id}`,
						};
					}
				}
			}
		});
	}

	nodeViewEventBus.emit('importWorkflowData', { data: workflowData });
	closeModal();
};

// Show section based on wizard step or show all if not in wizard mode
const showNodesSection = computed(() => !useWizardMode.value || currentStep.value === 1);
const showCredentialsSection = computed(
	() => credentialInfo.value.length > 0 && (!useWizardMode.value || currentStep.value === 2),
);
const showSubworkflowsSection = computed(
	() => subworkflowInfo.value.length > 0 && (!useWizardMode.value || currentStep.value === 3),
);

// Is on final step (for Import button)
const isOnFinalStep = computed(() => {
	if (!useWizardMode.value) return true;
	return currentStep.value === totalSteps.value;
});
</script>

<template>
	<Modal
		:name="WORKFLOW_IMPORT_MAPPING_MODAL_KEY"
		title="Import Workflow (Bitovi Enhanced)"
		:show-close="true"
		:center="true"
		width="700px"
	>
		<template #content>
			<div :class="$style.content">
				<!-- Wizard Step Indicator -->
				<div v-if="useWizardMode" :class="$style.stepIndicator">
					<div
						v-for="step in totalSteps"
						:key="step"
						:class="[
							$style.step,
							{
								[$style.activeStep]: step === currentStep,
								[$style.completedStep]: step < currentStep,
							},
						]"
					>
						<span :class="$style.stepNumber">{{ step }}</span>
						<span :class="$style.stepTitle">{{ stepTitles[step - 1] }}</span>
					</div>
				</div>

				<p :class="$style.description">
					<template v-if="useWizardMode">
						Step {{ currentStep }} of {{ totalSteps }}: {{ stepTitles[currentStep - 1] }}
					</template>
					<template v-else>
						Review the workflow configuration below. Map credentials and subworkflows to existing
						ones in your instance before importing.
					</template>
				</p>

				<!-- Step 1: Nodes Review -->
				<div v-if="showNodesSection" :class="$style.section">
					<h3 :class="$style.heading">Nodes ({{ nodes.length }})</h3>
					<div :class="$style.list">
						<div v-for="node in nodes" :key="node.id" :class="$style.item">
							<strong>{{ node.name }}</strong>
							<span :class="$style.details">{{ node.type }} (v{{ node.typeVersion }})</span>
						</div>
					</div>
				</div>

				<!-- Step 2: Credential Mapping -->
				<div v-if="showCredentialsSection" :class="$style.section">
					<h3 :class="$style.heading">Credential Mapping</h3>
					<p :class="$style.hint">
						Map imported credentials to existing credentials in your n8n instance.
					</p>
					<div :class="$style.mappingList">
						<div v-for="cred in credentialInfo" :key="cred.type" :class="$style.mappingRow">
							<div :class="$style.mappingInfo">
								<span :class="$style.mappingType">{{ cred.type }}</span>
								<span :class="$style.mappingOriginal">
									Original: {{ Array.from(cred.originalNames).join(', ') || 'Unknown' }}
								</span>
							</div>
							<div :class="$style.mappingSelect">
								<N8nSelect
									v-if="hasAvailableCredentials(cred.type)"
									v-model="credentialMappings[cred.type]"
									placeholder="Select credential..."
									size="small"
									filterable
								>
									<N8nOption value="__keep__" label="Keep original (may fail)" />
									<N8nOption
										v-for="availCred in getAvailableCredentials(cred.type)"
										:key="availCred.id"
										:value="availCred.id"
										:label="availCred.name"
									/>
								</N8nSelect>
								<n8n-button
									v-else
									type="tertiary"
									size="small"
									:class="$style.createLink"
									@click="openCreateCredential(cred.type)"
								>
									+ Create {{ cred.type }}
								</n8n-button>
							</div>
						</div>
					</div>
				</div>

				<!-- Step 3: Subworkflow Mapping -->
				<div v-if="showSubworkflowsSection" :class="$style.section">
					<h3 :class="$style.heading">Subworkflow Mapping</h3>
					<p :class="$style.hint">
						Map subworkflow calls to existing workflows in your n8n instance.
					</p>
					<div :class="$style.mappingList">
						<div v-for="sub in subworkflowInfo" :key="sub.nodeId" :class="$style.mappingRow">
							<div :class="$style.mappingInfo">
								<span :class="$style.mappingType">
									{{ sub.nodeName }}
									<span v-if="sub.nodeType === 'agent'" :class="$style.badge">Agent</span>
								</span>
								<span :class="$style.mappingOriginal"> Original: {{ sub.originalName }} </span>
							</div>
							<div :class="$style.mappingSelect">
								<N8nSelect
									v-if="!loadingWorkflows && availableWorkflows.length > 0"
									v-model="subworkflowMappings[sub.nodeId]"
									placeholder="Select workflow..."
									size="small"
									filterable
								>
									<N8nOption value="__keep__" label="Keep original (may fail)" />
									<N8nOption
										v-for="wf in availableWorkflows"
										:key="wf.id"
										:value="wf.id"
										:label="wf.name"
									/>
								</N8nSelect>
								<span v-else-if="loadingWorkflows" :class="$style.loading">
									Loading workflows...
								</span>
								<span v-else :class="$style.noItems"> No workflows found </span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</template>
		<template #footer>
			<div :class="$style.footer">
				<div :class="$style.footerLeft">
					<n8n-button v-if="useWizardMode && currentStep > 1" type="secondary" @click="prevStep">
						Back
					</n8n-button>
				</div>
				<div :class="$style.footerRight">
					<n8n-button type="secondary" @click="closeModal"> Cancel </n8n-button>
					<n8n-button v-if="useWizardMode && !isOnFinalStep" type="primary" @click="nextStep">
						Next
					</n8n-button>
					<n8n-button v-if="isOnFinalStep" type="primary" @click="confirm"> Import </n8n-button>
				</div>
			</div>
		</template>
	</Modal>
</template>

<style lang="scss" module>
.content {
	padding: var(--spacing-s);
	max-height: 60vh;
	overflow-y: auto;
}

.stepIndicator {
	display: flex;
	justify-content: space-between;
	margin-bottom: var(--spacing-m);
	padding-bottom: var(--spacing-s);
	border-bottom: 1px solid var(--color-border-base);
}

.step {
	display: flex;
	align-items: center;
	gap: var(--spacing-2xs);
	opacity: 0.5;
}

.activeStep {
	opacity: 1;
}

.completedStep {
	opacity: 0.8;
}

.stepNumber {
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--color-background-dark);
	color: var(--color-text-light);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: var(--font-size-xs);
	font-weight: var(--font-weight-bold);
}

.activeStep .stepNumber {
	background: var(--color-primary);
	color: white;
}

.completedStep .stepNumber {
	background: var(--color-success);
	color: white;
}

.stepTitle {
	font-size: var(--font-size-xs);
	color: var(--color-text-light);
}

.activeStep .stepTitle {
	color: var(--color-text-base);
	font-weight: var(--font-weight-bold);
}

.description {
	margin-bottom: var(--spacing-m);
	color: var(--color-text-base);
}

.section {
	margin-top: var(--spacing-m);
}

.heading {
	font-size: var(--font-size-s);
	font-weight: var(--font-weight-bold);
	color: var(--color-text-base);
	margin-bottom: var(--spacing-xs);
	border-bottom: 1px solid var(--color-border-base);
	padding-bottom: var(--spacing-2xs);
}

.hint {
	font-size: var(--font-size-2xs);
	color: var(--color-text-light);
	margin-bottom: var(--spacing-s);
}

.list {
	display: flex;
	flex-direction: column;
	gap: var(--spacing-2xs);
}

.item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: var(--spacing-2xs) var(--spacing-xs);
	background: var(--color-background-xlight);
	border-radius: var(--border-radius-base);
}

.details {
	color: var(--color-text-light);
	font-size: var(--font-size-xs);
}

.mappingList {
	display: flex;
	flex-direction: column;
	gap: var(--spacing-s);
}

.mappingRow {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: var(--spacing-xs);
	background: var(--color-background-xlight);
	border-radius: var(--border-radius-base);
	gap: var(--spacing-m);
}

.mappingInfo {
	display: flex;
	flex-direction: column;
	gap: var(--spacing-3xs);
	flex: 1;
}

.mappingType {
	font-weight: var(--font-weight-bold);
	color: var(--color-text-base);
	display: flex;
	align-items: center;
	gap: var(--spacing-2xs);
}

.badge {
	font-size: var(--font-size-3xs);
	background: var(--color-secondary);
	color: white;
	padding: 2px 6px;
	border-radius: var(--border-radius-base);
	font-weight: var(--font-weight-regular);
}

.mappingOriginal {
	font-size: var(--font-size-2xs);
	color: var(--color-text-light);
}

.mappingSelect {
	min-width: 220px;
}

.noItems {
	font-size: var(--font-size-xs);
	color: var(--color-danger);
	font-style: italic;
}

.createLink {
	color: var(--color-primary);
}

.loading {
	font-size: var(--font-size-xs);
	color: var(--color-text-light);
	font-style: italic;
}

.footer {
	display: flex;
	justify-content: space-between;
	width: 100%;
}

.footerLeft {
	display: flex;
	gap: var(--spacing-xs);
}

.footerRight {
	display: flex;
	gap: var(--spacing-xs);
}
</style>
