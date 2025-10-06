# Workflow History API Documentation

This document describes the workflow history API endpoint that allows retrieving the version history of workflows via API key authentication.

## Endpoint

```
GET /api/v1/workflow-history/{id}
```

## Authentication

This endpoint requires API key authentication. Include your API key in the `X-N8N-API-KEY` header.

```bash
X-N8N-API-KEY: your-api-key-here
```

## Parameters

### Path Parameters

- `id` (string, required): The ID of the workflow to retrieve history for

### Query Parameters

- `take` (integer, optional): Number of history items to return. Default: 20, Maximum: 100
- `skip` (integer, optional): Number of history items to skip for pagination. Default: 0

## Example Usage

### Basic Request

```bash
curl -X GET "https://your-n8n-instance.com/api/v1/workflow-history/your-workflow-id" \
  -H "X-N8N-API-KEY: your-api-key-here"
```

### With Pagination

```bash
curl -X GET "https://your-n8n-instance.com/api/v1/workflow-history/your-workflow-id?take=10&skip=5" \
  -H "X-N8N-API-KEY: your-api-key-here"
```

## Response Format

### Success Response (200 OK)

```json
{
  "data": [
    {
      "workflowId": "workflow-123",
      "versionId": "version-456",
      "authors": "John Doe",
      "createdAt": "2023-01-01T12:00:00.000Z",
      "updatedAt": "2023-01-01T12:00:00.000Z"
    },
    {
      "workflowId": "workflow-123", 
      "versionId": "version-789",
      "authors": "Jane Smith",
      "createdAt": "2023-01-01T11:00:00.000Z",
      "updatedAt": "2023-01-01T11:00:00.000Z"
    }
  ]
}
```

### Response Fields

- `workflowId`: The ID of the workflow this version belongs to
- `versionId`: The unique ID of this workflow version
- `authors`: The author(s) who created this version
- `createdAt`: ISO 8601 timestamp when this version was created
- `updatedAt`: ISO 8601 timestamp when this version was last updated

**Note**: For security and performance reasons, the full workflow definition (nodes and connections) is not included in the response. Only metadata about the versions is returned.

## Error Responses

### 401 Unauthorized
The API key is missing or invalid.

```json
{
  "message": "Unauthorized"
}
```

### 403 Forbidden  
The API key doesn't have the required `workflow:read` scope, or workflow history feature is not licensed.

```json
{
  "message": "Forbidden"
}
```

### 404 Not Found
The workflow doesn't exist or the user doesn't have access to it.

```json
{
  "message": "Not Found"
}
```

## Required API Key Scopes

Your API key must have the `workflow:read` scope to access this endpoint.

## License Requirements

This endpoint requires the **Workflow History** feature to be licensed and enabled. If you're using n8n Enterprise Edition, this feature may be available depending on your license. Contact your n8n administrator if you receive 403 Forbidden errors.

## Rate Limiting

This endpoint is subject to the same rate limiting as other public API endpoints. Please refer to your n8n instance's API documentation for specific rate limits.

## Notes

- History items are returned in descending order by creation date (newest first)
- Empty workflows (those with no history) will return an empty array
- Pagination is recommended for workflows with many versions to avoid large response payloads
- The workflow history feature may need to be explicitly enabled in your n8n configuration