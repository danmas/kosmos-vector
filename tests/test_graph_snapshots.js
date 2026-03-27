/**
 * Test script for Graph Snapshots API
 * 
 * Usage: 
 *   bun tests/test_graph_snapshots.js
 * 
 * Prerequisites:
 *   1. Run migration: psql -U carl -d kosmos_db -f scripts/create_graph_snapshots_table.sql
 *   2. Start server: bun start
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3200';
const CONTEXT_CODE = 'TEST';

async function testGraphSnapshotsAPI() {
  console.log('=== Testing Graph Snapshots API ===\n');
  
  let createdSnapshotId = null;

  // 1. GET list (should be empty or have some snapshots)
  console.log('1. GET /api/graph-snapshots - List all snapshots');
  try {
    const response = await fetch(`${BASE_URL}/api/graph-snapshots?context-code=${CONTEXT_CODE}`);
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${data.success}`);
    console.log(`   Snapshots count: ${data.snapshots?.length || 0}`);
    console.log('   ✅ PASSED\n');
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  // 2. POST create new snapshot
  console.log('2. POST /api/graph-snapshots - Create new snapshot');
  try {
    const response = await fetch(`${BASE_URL}/api/graph-snapshots?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Snapshot - API Test',
        nodeIds: ['node1', 'node2', 'node3'],
        selectedNodeIds: ['node1'],
        focusedNodeIds: ['node2'],
        hiddenLinkTypes: ['imports'],
        linkCount: 5,
        previewNodeNames: ['Node 1', 'Node 2', 'Node 3']
      })
    });
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${data.success}`);
    
    if (data.snapshot) {
      createdSnapshotId = data.snapshot.id;
      console.log(`   Created ID: ${createdSnapshotId}`);
      console.log(`   Name: ${data.snapshot.name}`);
      console.log(`   Node count: ${data.snapshot.nodeCount}`);
    }
    console.log('   ✅ PASSED\n');
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  // 3. GET snapshot by ID
  if (createdSnapshotId) {
    console.log(`3. GET /api/graph-snapshots/${createdSnapshotId} - Get by ID`);
    try {
      const response = await fetch(`${BASE_URL}/api/graph-snapshots/${createdSnapshotId}?context-code=${CONTEXT_CODE}`);
      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Success: ${data.success}`);
      console.log(`   Name: ${data.snapshot?.name}`);
      console.log(`   NodeIds: ${JSON.stringify(data.snapshot?.nodeIds)}`);
      console.log('   ✅ PASSED\n');
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
    }

    // 4. PATCH update name
    console.log(`4. PATCH /api/graph-snapshots/${createdSnapshotId} - Update name`);
    try {
      const response = await fetch(`${BASE_URL}/api/graph-snapshots/${createdSnapshotId}?context-code=${CONTEXT_CODE}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Test Snapshot Name'
        })
      });
      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Success: ${data.success}`);
      console.log(`   New name: ${data.snapshot?.name}`);
      console.log('   ✅ PASSED\n');
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
    }
  }

  // 5. GET /export
  console.log('5. GET /api/graph-snapshots/export - Export all snapshots');
  try {
    const response = await fetch(`${BASE_URL}/api/graph-snapshots/export?context-code=${CONTEXT_CODE}`);
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${data.success}`);
    console.log(`   Version: ${data.version}`);
    console.log(`   Snapshots count: ${data.snapshots?.length || 0}`);
    console.log(`   Exported at: ${data.exportedAt}`);
    console.log('   ✅ PASSED\n');
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  // 6. POST /import (test with a sample snapshot)
  console.log('6. POST /api/graph-snapshots/import - Import snapshots');
  try {
    const importSnapshotId = `snap_${Date.now()}_imported`;
    const response = await fetch(`${BASE_URL}/api/graph-snapshots/import?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        snapshots: [
          {
            id: importSnapshotId,
            name: 'Imported Snapshot',
            createdAt: new Date().toISOString(),
            contextCode: CONTEXT_CODE,
            nodeIds: ['imported1', 'imported2'],
            selectedNodeIds: [],
            focusedNodeIds: [],
            hiddenLinkTypes: [],
            nodeCount: 2,
            linkCount: 0,
            previewNodeNames: ['Imported 1', 'Imported 2']
          }
        ]
      })
    });
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Success: ${data.success}`);
    console.log(`   Imported: ${data.imported}`);
    console.log(`   Skipped: ${data.skipped}`);
    console.log(`   Total: ${data.total}`);
    console.log('   ✅ PASSED\n');
    
    // Clean up imported snapshot
    if (data.imported > 0) {
      await fetch(`${BASE_URL}/api/graph-snapshots/${importSnapshotId}?context-code=${CONTEXT_CODE}`, {
        method: 'DELETE'
      });
    }
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  // 7. DELETE snapshot
  if (createdSnapshotId) {
    console.log(`7. DELETE /api/graph-snapshots/${createdSnapshotId} - Delete snapshot`);
    try {
      const response = await fetch(`${BASE_URL}/api/graph-snapshots/${createdSnapshotId}?context-code=${CONTEXT_CODE}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Success: ${data.success}`);
      console.log(`   Message: ${data.message}`);
      console.log('   ✅ PASSED\n');
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
    }
  }

  // 8. Verify deletion - should return 404
  if (createdSnapshotId) {
    console.log(`8. GET /api/graph-snapshots/${createdSnapshotId} - Verify deletion (should 404)`);
    try {
      const response = await fetch(`${BASE_URL}/api/graph-snapshots/${createdSnapshotId}?context-code=${CONTEXT_CODE}`);
      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Expected 404: ${response.status === 404 ? '✅ Yes' : '❌ No'}`);
      console.log('   ✅ PASSED\n');
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
    }
  }

  // 9. Test validation - missing name
  console.log('9. POST /api/graph-snapshots - Validation test (missing name)');
  try {
    const response = await fetch(`${BASE_URL}/api/graph-snapshots?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeIds: ['node1']
      })
    });
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Expected 400: ${response.status === 400 ? '✅ Yes' : '❌ No'}`);
    console.log(`   Error: ${data.error}`);
    console.log('   ✅ PASSED\n');
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  // 10. Test validation - missing context-code
  console.log('10. GET /api/graph-snapshots - Validation test (missing context-code)');
  try {
    const response = await fetch(`${BASE_URL}/api/graph-snapshots`);
    const data = await response.json();
    console.log(`   Status: ${response.status}`);
    console.log(`   Expected 400: ${response.status === 400 ? '✅ Yes' : '❌ No'}`);
    console.log(`   Error: ${data.error}`);
    console.log('   ✅ PASSED\n');
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
  }

  console.log('=== All tests completed ===');
}

// Run tests
testGraphSnapshotsAPI().catch(console.error);
