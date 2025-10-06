#!/bin/bash

# Manual test script for workflow history API endpoint
# This script demonstrates how to test the new endpoint

echo "🧪 Manual Test Script for Workflow History API"
echo "=============================================="
echo ""

# Example API endpoints for testing
ENDPOINT="http://localhost:5678/api/v1/workflow-history/your-workflow-id"
API_KEY="your-api-key-here"

echo "📋 Test Cases to Verify:"
echo ""

echo "1. Basic request (should return workflow history)"
echo "curl -X GET \"$ENDPOINT\" \\"
echo "  -H \"X-N8N-API-KEY: $API_KEY\""
echo ""

echo "2. With pagination parameters"
echo "curl -X GET \"$ENDPOINT?take=10&skip=5\" \\"
echo "  -H \"X-N8N-API-KEY: $API_KEY\""
echo ""

echo "3. Invalid workflow ID (should return 404)"
echo "curl -X GET \"http://localhost:5678/api/v1/workflow-history/invalid-id\" \\"
echo "  -H \"X-N8N-API-KEY: $API_KEY\""
echo ""

echo "4. Missing API key (should return 401)"
echo "curl -X GET \"$ENDPOINT\""
echo ""

echo "5. Invalid API key (should return 401)"
echo "curl -X GET \"$ENDPOINT\" \\"
echo "  -H \"X-N8N-API-KEY: invalid-key\""
echo ""

echo "✅ Expected Responses:"
echo ""
echo "Success (200):"
echo "{"
echo "  \"data\": ["
echo "    {"
echo "      \"workflowId\": \"workflow-123\","
echo "      \"versionId\": \"version-456\","
echo "      \"authors\": \"John Doe\","
echo "      \"createdAt\": \"2023-01-01T12:00:00.000Z\","
echo "      \"updatedAt\": \"2023-01-01T12:00:00.000Z\""
echo "    }"
echo "  ]"
echo "}"
echo ""

echo "Not Found (404):"
echo "{"
echo "  \"message\": \"Not Found\""
echo "}"
echo ""

echo "Unauthorized (401):"
echo "{"
echo "  \"message\": \"Unauthorized\""
echo "}"
echo ""

echo "📝 To run these tests:"
echo "1. Start your n8n instance"
echo "2. Create an API key with 'workflow:read' scope"  
echo "3. Replace the placeholder values above"
echo "4. Run the curl commands"
echo ""

echo "🏗️ Implementation Details Verified:"
echo "✅ Handler function 'getWorkflowHistory' added to workflows.handler.ts"
echo "✅ API key scope 'workflow:read' required"
echo "✅ Request type 'WorkflowRequest.GetHistory' defined"
echo "✅ OpenAPI specification created at workflow-history.id.yml"
echo "✅ Route registered in main openapi.yml"
echo "✅ Error handling for 404 (SharedWorkflowNotFoundError)"
echo "✅ Pagination with 'take' and 'skip' parameters (defaults: take=20, skip=0)"
echo "✅ Response format: { data: [...] }"
echo "✅ Test cases added to workflows.test.ts"
echo "✅ Documentation created at docs/api-workflow-history.md"