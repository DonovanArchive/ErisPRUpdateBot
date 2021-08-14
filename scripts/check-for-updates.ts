import { execSync } from "child_process";
import * as fs from "fs-extra";
import config from "../config.json";
import simpleGit from "simple-git/promise";
import { Octokit } from "@octokit/rest";
const workingDir = `${__dirname}/../run`;
fs.mkdirpSync(workingDir);

const ORIGIN_USER = config.checkForUpdates.remotes.origin.split("/").slice(-2)[0];
let GITHUB_USER: string, GITHUB_TOKEN: string;
if(process.argv.join(" ").includes("--dev")) {
	const privateConfig = require("../privateConfig.json") as typeof import("../privateConfig.json");
	GITHUB_USER = privateConfig.GITHUB_USER,
	GITHUB_TOKEN = privateConfig.GITHUB_TOKEN;
} else {
	GITHUB_USER = process.env.GITHUB_USER!;
	GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
}
if(!GITHUB_USER) throw new Error("Missing GITHUB_USER valye");
if(!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN value");

const octo = new Octokit({ auth: GITHUB_TOKEN });

process.nextTick(async() => {
	const b = Object.entries(config.checkForUpdates.branches);
	const r = Object.entries(config.checkForUpdates.remotes);

	// setup
	const git = simpleGit(workingDir);

	// clone
	await git.clone(config.checkForUpdates.remotes.origin, ".");
	execSync(`git config --local credential.helper '!f() { sleep 1; echo "username=${GITHUB_USER}"; echo "password=${GITHUB_TOKEN}"; }; f'`, {
		cwd: workingDir
	});

	// override it
	await git.removeRemote("origin");
	// add remotes
	for(const [name, url] of r) await git.addRemote(name, url/* `https://${config.checkForUpdates.auth.user}:${config.checkForUpdates.auth.token}@${url.slice(8)}` */);

	const pulls = await octo.request("GET /repos/{owner}/{repo}/pulls", {
		owner: ORIGIN_USER,
		repo: "eris"
	});

	const prRefList = pulls.data.map(d => d.head.ref);

	// loop branches
	for(const [branch, refs] of b) {
	console.log(`Checking the branch "${branch}"`);
	let outdated = false, currentRef = "unknown";
		try {
			// checkout branch
			await git.fetch("origin", branch);
			await git.checkout(branch);
			
			// get local commits
			const log = await git.log();
			const hashes = log.all.map(c => c.hash);
			// await git.branch(["-m", jobId]);

			// loop remotes
			for(const { name, branch: refBranch, remote } of refs) {
				currentRef = refBranch;
				// bring remote branch to local
				await git.fetch(remote, refBranch);
				// get remote commits
				const ls = await git.listRemote([remote, "-h", refBranch]);
				// slice off last part of ls-remote
				const hash = ls.toString().slice(0, 40);
				const prBranch = `${remote}/${refBranch}/${branch}/${hash}`;
				// check if latest commit is included in local commits
				if(!hashes.includes(hash)) {
					outdated = true;
					// check if one of the pull request branches matches our current
					if(prRefList.includes(prBranch)) {
						console.log(`Ref "${name}" is outdated, but a pull request was already found.`);
						continue;
					} else console.log(`Ref "${name}" is outdated, ${remote}/${refBranch} contains hash not included in local: ${hash}`);
					

					await git.fetch(remote, `${refBranch}:${prBranch}`);
					await git.checkout(prBranch);
					await git.push("self", prBranch);
					const pr = await octo.request("POST /repos/{owner}/{repo}/pulls", {
							owner: ORIGIN_USER,
							repo: "eris",
							title: `Remote Update (${branch}): ${remote}/${refBranch}`,
							head: `${process.env.GITHUB_USER}:${prBranch}`,
							base: branch,
							maintainer_can_modify: true
					}); 
					console.log(`Created pull request for "${name}", ${pr.data.html_url}`);

					// get all remote commits
					const branchLog = await git.log([`${remote}/${refBranch}`]);
					const branchHashes = branchLog.all.map(c => c.hash);
					
					// check for pull requests with a branch of one of our commit hashes
					// (new commits since last)
					const prDupRef = prRefList.filter(ref => branchHashes.some(hash => ref === `${remote}/${refBranch}/${branch}/${hash}`));
					for (const dup of prDupRef) {
						const oldPr = pulls.data.find(p => p.head.ref === dup)!.number;
						console.log(`(${remote}/${refBranch}) Closing old pull request #${oldPr}`);
						await octo.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
							owner: ORIGIN_USER,
							repo: "eris",
							issue_number: oldPr,
							body: `This pull request has been superseded by #${pr.data.number}`
						});
						await octo.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
							owner: ORIGIN_USER,
							repo: "eris",
							pull_number: oldPr,
							state: "closed"
						});
						await git.push(["self", "--delete", dup]).catch(() => null);
					}
				} else console.log(`Ref "${name}" is up-to-date, hash: ${hash}`);
			}
		} catch(err) {
			console.log(`Error updating "${currentRef}"`, err);
		}

		console.log(`Done processing branch "${branch}", ${outdated ? "" : "no "}changes were found`);
	}
	
	fs.removeSync(workingDir);
});
