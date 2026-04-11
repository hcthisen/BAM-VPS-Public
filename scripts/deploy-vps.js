// Deploy script — copies local build to VPS via SSH/SFTP
// Run with: node scripts/deploy-vps.js
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");

const VPS_HOST = process.env.VPS_IP || "204.168.249.5";
const VPS_USER = process.env.VPS_USER || "root";
const VPS_PASS = process.env.VPS_PASSWORD || "Bamvps123";
const REMOTE_DIR = "/opt/bam";

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "", errOut = "";
      stream.on("data", (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on("data", (d) => { errOut += d; process.stderr.write(d); });
      stream.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`Exit ${code}: ${errOut}`)));
    });
  });
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);
    writeStream.on("close", resolve);
    writeStream.on("error", reject);
    readStream.pipe(writeStream);
  });
}

function uploadDir(sftp, localDir, remoteDir, conn) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create remote dir
      await exec(conn, `mkdir -p ${remoteDir}`).catch(() => {});

      const entries = fs.readdirSync(localDir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip unwanted dirs
        if ([".git", "node_modules", ".next", "designs", ".env", "bam-deploy-tmp", "bam-old"].includes(entry.name)) continue;

        const localPath = path.join(localDir, entry.name);
        const remotePath = `${remoteDir}/${entry.name}`;

        if (entry.isDirectory()) {
          await uploadDir(sftp, localPath, remotePath, conn);
        } else {
          await uploadFile(sftp, localPath, remotePath);
        }
      }
      resolve();
    } catch (e) { reject(e); }
  });
}

async function main() {
  const conn = new Client();

  await new Promise((resolve, reject) => {
    conn.on("ready", resolve).on("error", reject)
      .connect({ host: VPS_HOST, port: 22, username: VPS_USER, password: VPS_PASS });
  });

  console.log("Connected to VPS.\n");

  console.log("[1/5] Backing up .env...");
  await exec(conn, `cp ${REMOTE_DIR}/.env /tmp/bam-env-backup`);

  console.log("[2/5] Uploading source files...");
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  // Upload key source directories
  const localRoot = path.resolve(__dirname, "..");
  await exec(conn, `rm -rf ${REMOTE_DIR}/src ${REMOTE_DIR}/db ${REMOTE_DIR}/scripts`);

  for (const dir of ["src", "db", "scripts"]) {
    console.log(`  Uploading ${dir}/...`);
    await uploadDir(sftp, path.join(localRoot, dir), `${REMOTE_DIR}/${dir}`, conn);
  }

  // Upload root config files
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "next.config.ts"]) {
    const localPath = path.join(localRoot, file);
    if (fs.existsSync(localPath)) {
      console.log(`  Uploading ${file}`);
      await uploadFile(sftp, localPath, `${REMOTE_DIR}/${file}`);
    }
  }

  sftp.end();

  // Restore .env
  await exec(conn, `cp /tmp/bam-env-backup ${REMOTE_DIR}/.env`);

  console.log("\n[3/5] Installing dependencies...");
  await exec(conn, `cd ${REMOTE_DIR} && npm ci --omit=dev 2>&1 | tail -3`);

  console.log("\n[4/5] Building...");
  await exec(conn, `cd ${REMOTE_DIR} && npm run build 2>&1 | tail -5`);

  console.log("\n[5/5] Migrating and restarting...");
  await exec(conn, `cd ${REMOTE_DIR} && npx tsx scripts/migrate.ts 2>&1 | tail -3`);
  await exec(conn, `cd ${REMOTE_DIR} && npx tsx scripts/seed_reference_data.ts 2>&1 | tail -1`);
  await exec(conn, `chown -R bam:bam ${REMOTE_DIR} 2>/dev/null; systemctl restart bam-app bam-worker`);

  console.log("\n=== DEPLOY COMPLETE ===");
  await exec(conn, `echo "bam-app: $(systemctl is-active bam-app)" && echo "bam-worker: $(systemctl is-active bam-worker)"`);

  conn.end();
}

main().catch((e) => { console.error("Deploy failed:", e.message); process.exit(1); });
