import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization');
  const secret = process.env.SYNC_SHARED_SECRET;

  if (secret && authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('Starting sync-worker...');
    const { stdout, stderr } = await execAsync('node sync-worker.js', {
      env: process.env,
      timeout: 360000,
    });

    console.log('Sync output:', stdout);
    if (stderr) console.error('Sync errors:', stderr);

    return new Response(JSON.stringify({ success: true, output: stdout }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const err = error as Error;
    console.error('Sync failed:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
