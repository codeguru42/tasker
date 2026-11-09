import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../helpers/temp.js";
import { checkBashCommand } from "../../../src/assistant/pi/bash-command-check.js";

const DENIED = "git push";

const CAUSES = {
  parse: "the line does not parse",
  expansion: "an expansion can change a command name or a word of a denied command",
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
  array: "an array index can run a command",
  gitConfig: "git can run a command line from a configuration value",
  xargs: "xargs can add a denied command from its input",
};

interface CommandRow {
  command: string;
  entries?: string[];
  result: "pass" | "match" | "cause";
  cause?: string;
  entry?: string;
  stub?: string;
}

const commandRows: CommandRow[] = [
  // Requirement 13 command positions.
  { command: "echo ok; git push", result: "match" },
  { command: "echo ok; git status", result: "pass" },
  { command: "echo ok & git push", result: "match" },
  { command: "echo ok & git status", result: "pass" },
  { command: "echo ok && git push", result: "match" },
  { command: "echo ok && git status", result: "pass" },
  { command: "false || git push", result: "match" },
  { command: "false || git status", result: "pass" },
  { command: "echo ok | git push", result: "match" },
  { command: "echo ok | git status", result: "pass" },
  { command: "echo data | bash run.sh", result: "cause", cause: CAUSES.input },
  { command: "echo data |& bash run.sh", result: "cause", cause: CAUSES.input },
  { command: "echo data |& git status", result: "pass", stub: "git" },
  { command: "bash run.sh |& cat", result: "pass", stub: "cat" },
  { command: "echo ok |& git push", result: "match" },
  { command: "echo ok |& git status", result: "pass" },
  { command: "echo ok\ngit push", result: "match" },
  { command: "echo ok\ngit status", result: "pass" },
  { command: "! git push", result: "match" },
  { command: "! git status", result: "pass" },
  { command: "time git push", result: "match" },
  { command: "time git status", result: "pass" },
  { command: "time -p git push", result: "match" },
  { command: "time -p git status", result: "pass" },
  { command: "coproc git push", result: "match" },
  { command: "coproc git status", result: "pass" },
  { command: "A=1 git status", result: "pass" },
  { command: ">out git status", result: "pass" },
  { command: "( git push )", result: "match" },
  { command: "( git status )", result: "pass" },
  { command: "{ git push; }", result: "match" },
  { command: "{ git status; }", result: "pass" },
  { command: "if git status; then :; fi", result: "pass" },
  { command: "while false; do git status; done", result: "pass" },
  { command: "until git push; do :; done", result: "match" },
  { command: "until true; do git status; done", result: "pass" },
  { command: "for x in a; do git status; done", result: "pass" },
  { command: "select x in a; do git push; done", result: "match" },
  { command: "select x in a; do git status; done", result: "pass" },
  { command: "case a in a) git push;; esac", result: "match" },
  { command: "case a in a) git status;; esac", result: "pass" },
  { command: "[[ $(git push) == x ]]", result: "match" },
  { command: "[[ x == x ]]", result: "pass" },
  { command: "(( $(git push) ))", result: "match" },
  { command: "(( 1 + 2 ))", result: "pass" },
  { command: "echo <(git push)", result: "match" },
  { command: "echo <(git status)", result: "pass" },
  { command: "echo >(git push)", result: "match" },
  { command: "echo >(git status)", result: "pass" },
  { command: "echo ${x:-ok}", result: "pass" },
  { command: "echo >out", result: "pass" },
  { command: "echo <<< ok", result: "pass" },
  { command: "cat <<EOF\nplain\nEOF", result: "pass" },
  // Requirement 15 reader forms and findings 3 to 6.
  { command: "script -c'git push' /dev/null", result: "match" },
  { command: "script -qc'git push' /dev/null", result: "match" },
  { command: "su -c'git push'", result: "match" },
  { command: "flock x -c'git push'", result: "match" },
  { command: "env -S'git push'", result: "match" },
  { command: "env --split-string='git push'", result: "match" },
  { command: "mapfile -C'git push' -c1 a", result: "match" },
  { command: "readarray -C 'git push' -c1 a", result: "match" },
  { command: "watch 'git push'", result: "match" },
  { command: "watch -n 1 'git push'", result: "match" },
  { command: "watch -n1 git push", result: "match" },
  { command: "watch git status", result: "pass", stub: "watch" },
  { command: "sudo 'git push'", result: "match" },
  { command: "sudo -u x git push", result: "match" },
  { command: "EDITOR='git push' ls", result: "match" },
  { command: "export EDITOR='git push'", result: "match" },
  { command: "env EDITOR='git push' ls", result: "match" },
  { command: "echo EDITOR='git push'", result: "pass" },
  { command: "ls EDITOR='git push'", result: "pass", stub: "ls" },
  { command: "echo BASH_CMDS", result: "cause", cause: CAUSES.binding },
  { command: "echo BASH_ALIASES", result: "cause", cause: CAUSES.binding },
  { command: "echo expand_aliases", result: "cause", cause: CAUSES.binding },
  { command: "fc", result: "cause", cause: CAUSES.binding },
  { command: "fc -l", result: "cause", cause: CAUSES.binding },
  { command: "history", result: "cause", cause: CAUSES.binding },
  { command: "history -s x", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=x export", result: "cause", cause: CAUSES.binding },
  { command: "ENV=x env", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=x env", result: "cause", cause: CAUSES.binding },
  { command: "ENV=x export", result: "cause", cause: CAUSES.binding },
  { command: "export BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "export ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "env BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "env ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "declare BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "declare ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "typeset BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "typeset ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "local BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "local ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "readonly BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "readonly ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "source x.sh < y", result: "cause", cause: CAUSES.input },
  { command: "source $SCRIPT", result: "cause", cause: CAUSES.expansion },
  { command: ". ${SCRIPT}", result: "cause", cause: CAUSES.expansion },
  { command: "source //proc/self/fd/0", result: "cause", cause: CAUSES.input },
  { command: ". /./dev/stdin", result: "cause", cause: CAUSES.input },
  { command: "echo \\$(b)", result: "cause", cause: CAUSES.array },
  { command: 'echo "\\$(b)"', result: "cause", cause: CAUSES.array },
  // Remaining wrapper rows from requirement 26.
  { command: "env git status", result: "pass", stub: "env" },
  { command: "env git push", result: "match" },
  { command: "command git push", result: "match" },
  { command: "nohup git push", result: "match" },
  { command: "nice git push", result: "match" },
  { command: "stdbuf -oL git push", result: "match" },
  { command: "builtin eval 'git push'", result: "match" },
  { command: "setsid git push", result: "match" },
  { command: "ionice git push", result: "match" },
  { command: "chrt -f 1 git push", result: "match" },
  { command: "taskset -c 0 git push", result: "match" },
  { command: "flock x git push", result: "match" },
  { command: "watch git push", result: "match" },
  { command: "busybox git push", result: "match" },
  { command: "sudo -u x git status", result: "pass", stub: "sudo" },
  { command: "watch -n1 git status", result: "pass", stub: "watch" },
  { command: "env --split-string='git status'", result: "pass", stub: "env" },
  { command: "script -c'git status' /dev/null", result: "pass", stub: "script" },
  { command: "script -qc'git status' /dev/null", result: "pass", stub: "script" },
  { command: "su -c'git status'", result: "pass", stub: "su" },
  { command: "flock x -c'git status'", result: "pass", stub: "flock" },
  { command: "mapfile -C'echo ok' -c1 a", result: "pass" },
  { command: "bash -co errexit 'git status'", result: "pass", stub: "bash" },
  { command: "bash -- git status", result: "pass", stub: "bash" },
  { command: "bash --init-file x run.sh", result: "pass", stub: "bash" },
  { command: "bash --unknown", result: "cause", cause: CAUSES.option },
  { command: "bash run.sh < input.txt", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh <<< input", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh <<EOF\nEOF", result: "cause", cause: CAUSES.input },
  { command: "bash /proc/self/fd/0", result: "cause", cause: CAUSES.input },
  { command: "git -v push", result: "match" },
  { command: "git -h push", result: "match" },
  { command: "git --no-pager push", result: "match" },
  { command: "git --git-dir=. push", result: "match" },
  { command: "git --exec-path=. push", result: "match" },
  { command: "git -C . push", result: "match" },
  { command: "git -c user.name=x push", result: "match" },
  { command: "git --work-tree . push", result: "match" },
  { command: "git --namespace x push", result: "match" },
  { command: "git --config-env a=B status", result: "cause", cause: CAUSES.gitConfig },
  { command: "git --attr-source=. push", result: "match" },
  { command: "git -C $DIR status", result: "cause", cause: CAUSES.expansion },
  { command: "git -C. status", result: "cause", cause: CAUSES.option },
  { command: "git -cfoo status", result: "cause", cause: CAUSES.option },
  { command: "git --config-env=a=B status", result: "cause", cause: CAUSES.gitConfig },
  { command: "gi[t] status", result: "cause", cause: CAUSES.expansion },
  { command: "~git push", result: "cause", cause: CAUSES.expansion },
  { command: "find . -execdir git push \\;", result: "match" },
  { command: "find . -execdir git status \\;", result: "pass" },
  { command: "find . -exec git push {} +", result: "match" },
  { command: "find . -execdir git push {} +", result: "match" },
  { command: "find . -ok git push {} +", result: "match" },
  { command: "find . -okdir git push {} +", result: "match" },
  { command: "find . -exe?", result: "cause", cause: CAUSES.expansion },
  { command: "find . {a,b}", result: "cause", cause: CAUSES.expansion },
  { command: "find . -name *.ts -print", result: "pass", stub: "find" },
  { command: "find . -exec git status {} +", result: "cause", cause: CAUSES.expansion },
  { command: "find . -ok git status {} +", result: "cause", cause: CAUSES.expansion },
  { command: "echo x | xargs find .", result: "cause", cause: CAUSES.xargs },
  { command: "echo x | xargs sudo", result: "cause", cause: CAUSES.xargs },
  { command: "echo x | xargs bash -c true", result: "cause", cause: CAUSES.xargs },
  { command: "find . $(git status)", result: "cause", cause: CAUSES.expansion },
  { command: "find . <(git status)", result: "cause", cause: CAUSES.expansion },
  { command: "find . $((1 + 2))", result: "cause", cause: CAUSES.expansion },
  { command: "command git status", result: "pass", stub: "git" },
  { command: "exec git status", result: "pass", stub: "git" },
  { command: "nohup git status", result: "pass", stub: "nohup" },
  { command: "nice git status", result: "pass", stub: "nice" },
  { command: "doas git status", result: "pass", stub: "doas" },
  { command: "xargs ls", result: "pass", stub: "xargs" },
  { command: "timeout 9 git status", result: "pass", stub: "timeout" },
  { command: "stdbuf -oL git status", result: "pass", stub: "stdbuf" },
  { command: "builtin echo ok", result: "pass" },
  { command: "setsid git status", result: "pass", stub: "setsid" },
  { command: "ionice git status", result: "pass", stub: "ionice" },
  { command: "chrt -f 1 git status", result: "pass", stub: "chrt" },
  { command: "taskset -c 0 git status", result: "pass", stub: "taskset" },
  { command: "flock x git status", result: "pass", stub: "flock" },
  { command: "busybox git status", result: "pass", stub: "busybox" },
  { command: "git status && ls", result: "pass" },
  { command: "cd /tmp && git push", result: "match" },
  { command: 'echo "git push"', result: "pass" },
  { command: "A=1 B=2 git push", result: "match" },
  { command: "echo $(git push)", result: "match" },
  { command: "echo `git push`", result: "match" },
  { command: 'echo "`git push`"', result: "match" },
  { command: "echo \"<<'EOF'\"\ngit push\nEOF", result: "match" },
  { command: "echo hi\ngit push", result: "match" },
  { command: "time -p git push", result: "match" },
  { command: "coproc git push", result: "match" },
  { command: "2>&1 git push", result: "match" },
  { command: "> /tmp/x git push", result: "match" },
  { command: "if git push; then :; fi", result: "match" },
  { command: "while git push; do :; done", result: "match" },
  { command: "f() ( git push )", result: "match" },
  { command: 'cat <<"EOF"\n$(git push)\nEOF\ngit push', result: "match" },
  { command: "$'git' push", result: "cause", cause: CAUSES.expansion },
  { command: "gi\\\nt push", result: "match" },
  { command: "git\\\n push", result: "match" },
  { command: "echo ${x:-$(git push)}", result: "match" },
  { command: "cat <<EOF\n$(git push)\nEOF", result: "match" },
  { command: "cat << EOF\ngit push\nEOF", result: "pass" },
  { command: "cat <<- EOF\nx\n\tEOF", result: "pass" },
  { command: "cat << 'EOF'\n$(git push)\nEOF", result: "pass" },
  { command: "cat <<  EOF\n$(git push)\nEOF", result: "match" },
  { command: "echo $(printf '%s' \"$(git push)\")", result: "match" },
  { command: 'echo $(echo ")" ; git push)', result: "match" },
  { command: "echo $(case a in a) git push;; esac)", result: "match" },
  { command: 'echo "$(echo ")" ; git push)"', result: "match" },
  { command: "cat <<EOF\ngit push\nEOF", result: "pass" },
  { command: "echo >$(git push)", result: "match" },
  { command: "echo a > $(git push)", result: "match" },
  { command: "cat > >(git push)", result: "match" },
  { command: "echo a <<< $(git push)", result: "match" },
  { command: "echo $(( $(git push) ))", result: "match" },
  { command: "(( $(git push) ))", result: "match" },
  { command: "case x in $(git push)) echo ok;; esac", result: "match" },
  { command: "for x in $(git push); do echo ok; done", result: "match" },
  { command: "select x in $(git push); do echo ok; done", result: "match" },
  { command: "echo then git push", result: "pass" },
  { command: "echo do done fi", result: "pass" },
  { command: "then git status", result: "cause", cause: CAUSES.parse },
  { command: "do git status", result: "cause", cause: CAUSES.parse },
  { command: "done", result: "cause", cause: CAUSES.parse },
  { command: "fi", result: "cause", cause: CAUSES.parse },
  { command: "esac", result: "cause", cause: CAUSES.parse },
  { command: "}", result: "cause", cause: CAUSES.parse },
  { command: "echo $(( 1 + 2 ))", result: "pass" },
  { command: "cat <<'EOF'\n$(git push)\nEOF", result: "pass" },
  { command: "f() { git push; }", result: "match" },
  { command: "echo hi; )", result: "cause", cause: CAUSES.parse },
  { command: "herdr agent list", entries: [DENIED, "herdr"], result: "match", entry: "herdr" },
  { command: "ls ~/herdr", entries: ["herdr"], result: "pass" },
  { command: "/usr/bin/herdr", entries: ["herdr"], result: "match", entry: "herdr" },
  { command: "./herdr", entries: ["herdr"], result: "match", entry: "herdr" },
  { command: "/usr/lib/git-core/git-push", result: "match" },
  { command: "'git' push", result: "match" },
  { command: "g\\it push", result: "match" },
  { command: '"git" "push"', result: "match" },
  { command: "arr[0]=x", result: "pass" },
  { command: "arr[0]=x npm test", result: "pass" },
  { command: "arr[0]=x git push", result: "match" },
  { command: "gi[t] push", result: "cause", cause: CAUSES.expansion },
  { command: "{gh,} api", result: "cause", cause: CAUSES.expansion },
  { command: "$cmd push", result: "cause", cause: CAUSES.expansion },
  { command: '"$(which git)" push', result: "cause", cause: CAUSES.expansion },
  { command: '"$@"', result: "cause", cause: CAUSES.expansion },
  { command: "sh -c 'git push'", result: "match" },
  { command: 'bash -lc "git push"', result: "match" },
  { command: "bash -co errexit 'git push'", result: "match" },
  { command: "fish -c 'git push'", result: "match" },
  { command: "fish -ec 'git push'", result: "match" },
  { command: "zsh -c 'git push'", result: "match" },
  { command: "ksh -c 'git push'", result: "match" },
  { command: "dash -c 'git push'", result: "match" },
  { command: "rbash -c 'git push'", result: "match" },
  { command: "ash -c 'git push'", result: "match" },
  { command: "mksh -c 'git push'", result: "match" },
  { command: "yash -c 'git push'", result: "match" },
  { command: "bash +O extglob -c 'git push'", result: "match" },
  { command: "bash", result: "cause", cause: CAUSES.input },
  { command: "sh", result: "cause", cause: CAUSES.input },
  { command: 'bash -c "$X"', result: "cause", cause: CAUSES.expansion },
  { command: "bash <(echo git push)", result: "cause", cause: CAUSES.expansion },
  { command: "bash /dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "echo 'git push' | bash", result: "cause", cause: CAUSES.input },
  { command: ". <(echo git push)", result: "cause", cause: CAUSES.expansion },
  { command: "hash -p /usr/bin/git g", result: "cause", cause: CAUSES.binding },
  { command: "BASH_CMDS[g]=/usr/bin/git", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ALIASES[x]=git", result: "cause", cause: CAUSES.binding },
  { command: "bash //dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh < input.txt", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh", result: "pass" },
  { command: "bash --rcfile x run.sh", result: "pass", stub: "bash" },
  { command: "source x.sh", result: "pass" },
  { command: ". ./x.sh", result: "pass" },
  { command: "bash *.sh", result: "cause", cause: CAUSES.expansion },
  { command: "alias g=git", result: "cause", cause: CAUSES.binding },
  { command: "fc -s status=push", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=<(echo git push) bash -c true", result: "cause", cause: CAUSES.binding },
  { command: "ENV=<(echo git push) sh -c true", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=$X bash -c true", result: "cause", cause: CAUSES.binding },
  { command: "flock /tmp/l -c 'git push'", result: "match" },
  { command: "su -c 'git push' root", result: "match" },
  { command: "script -c 'git push' /dev/null", result: "match" },
  { command: "mapfile -C 'git push' -c 1 a < /dev/null", result: "match" },
  { command: "readarray -C 'git push' -c 1 a", result: "match" },
  { command: "set -H", result: "cause", cause: CAUSES.binding },
  { command: "set +H", result: "cause", cause: CAUSES.binding },
  { command: "history", result: "cause", cause: CAUSES.binding },
  { command: "history -s x", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=x export", result: "cause", cause: CAUSES.binding },
  { command: "ENV=x env", result: "cause", cause: CAUSES.binding },
  { command: "export BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "export ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "env BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "env ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "declare BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "typeset ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "local BASH_ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "readonly ENV=x", result: "cause", cause: CAUSES.binding },
  { command: "hash -pr", result: "cause", cause: CAUSES.binding },
  { command: "set -eH", result: "cause", cause: CAUSES.binding },
  { command: "set -o histexpand", result: "cause", cause: CAUSES.binding },
  { command: "shopt -s expand_aliases", result: "cause", cause: CAUSES.binding },
  { command: "sudo git push", result: "match" },
  { command: "exec git push", result: "match" },
  { command: "doas git push", result: "match" },
  { command: "setsid git push", result: "match" },
  { command: "ionice -c3 git push", result: "match" },
  { command: "chrt 1 git push", result: "match" },
  { command: "taskset 1 git push", result: "match" },
  { command: "flock /tmp/l git push", result: "match" },
  { command: "builtin exec git push", result: "match" },
  { command: "busybox git push", result: "match" },
  { command: "stdbuf -o0 git push", result: "match" },
  { command: "timeout -s KILL 5 git push", result: "match" },
  { command: "sudo $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "timeout 5 $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "flock /tmp/l -c $COMMAND", result: "cause", cause: CAUSES.expansion },
  { command: "zsh -c 'git status'", result: "pass", stub: "zsh" },
  { command: "ksh -c 'git status'", result: "pass", stub: "ksh" },
  { command: "dash -c 'git status'", result: "pass", stub: "dash" },
  { command: "rbash -c 'git status'", result: "pass", stub: "rbash" },
  { command: "ash -c 'git status'", result: "pass", stub: "ash" },
  { command: "mksh -c 'git status'", result: "pass", stub: "mksh" },
  { command: "yash -c 'git status'", result: "pass", stub: "yash" },
  { command: "bash +O extglob -c 'git status'", result: "pass", stub: "bash" },
  { command: "flock /tmp/l -c 'git status'", result: "pass", stub: "flock" },
  { command: "su -c 'git status' root", result: "pass", stub: "su" },
  { command: "script -c 'git status' /dev/null", result: "pass", stub: "script" },
  { command: "mapfile -t a < /dev/null", result: "pass" },
  { command: "readarray -t a < /dev/null", result: "pass" },
  { command: "sudo git status", result: "pass", stub: "sudo" },
  { command: "exec git status", result: "pass", stub: "git" },
  { command: "doas git status", result: "pass", stub: "doas" },
  { command: "setsid git status", result: "pass", stub: "setsid" },
  { command: "ionice -c3 git status", result: "pass", stub: "ionice" },
  { command: "chrt 1 git status", result: "pass", stub: "chrt" },
  { command: "taskset 1 git status", result: "pass", stub: "taskset" },
  { command: "flock /tmp/l git status", result: "pass", stub: "flock" },
  { command: "busybox git status", result: "pass", stub: "busybox" },
  { command: "stdbuf -o0 git status", result: "pass", stub: "stdbuf" },
  { command: "timeout -s KILL 5 git status", result: "pass", stub: "timeout" },
  { command: "env -i echo ok", result: "pass", stub: "env" },
  { command: "nice -n 5 git status", result: "pass", stub: "nice" },
  { command: "watch --version", result: "pass", stub: "watch" },
  { command: "nohup git status", result: "pass", stub: "nohup" },
  { command: "command git status", result: "pass", stub: "git" },
  { command: "stdbuf --version", result: "pass", stub: "stdbuf" },
  { command: "eval 'git status'", result: "pass", stub: "git" },
  { command: "sudo --version", result: "pass", stub: "sudo" },
  { command: "flock --version", result: "pass", stub: "flock" },
  { command: "su --version", result: "pass", stub: "su" },
  { command: "script --version", result: "pass", stub: "script" },
  { command: "set +x", result: "pass" },
  { command: "trap -p", result: "pass" },
  { command: "alias", result: "pass" },
  { command: "alias -p", result: "pass" },
  { command: "sudo --user $USER git status", result: "cause", cause: CAUSES.expansion },
  { command: "exec $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "doas --user $USER git status", result: "cause", cause: CAUSES.expansion },
  { command: "setsid $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "ionice -c $LEVEL git status", result: "cause", cause: CAUSES.expansion },
  { command: "chrt $LEVEL git status", result: "cause", cause: CAUSES.expansion },
  { command: "taskset $MASK git status", result: "cause", cause: CAUSES.expansion },
  { command: "flock /tmp/l $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "busybox $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "stdbuf -o $MODE git status", result: "cause", cause: CAUSES.expansion },
  { command: "timeout 5 $PROGRAM git status", result: "cause", cause: CAUSES.expansion },
  { command: "grep -n '$(' file", result: "cause", cause: CAUSES.array },
  { command: "echo '$(git push)'", result: "cause", cause: CAUSES.array },
  { command: "echo '`git push`'", result: "cause", cause: CAUSES.array },
  { command: "echo '${git push}'", result: "cause", cause: CAUSES.array },
  { command: "echo \\$\\(git push\\)", result: "cause", cause: CAUSES.array },
  { command: "echo \\`git push\\`", result: "cause", cause: CAUSES.array },
  { command: "echo \\$\\{git push\\}", result: "cause", cause: CAUSES.array },
  { command: "let 'x=a[$(git push)]'", result: "cause", cause: CAUSES.array },
  { command: "eval 'git push'", result: "match" },
  { command: "fish -C 'git push' x", result: "cause", cause: CAUSES.option },
  { command: "trap 'git push' EXIT", result: "match" },
  { command: "alias p='git push'", result: "cause", cause: CAUSES.binding },
  { command: "bash -s", result: "cause", cause: CAUSES.input },
  { command: "bash /./dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "bash /dev/fd/0", result: "cause", cause: CAUSES.input },
  { command: "bash ../x.sh", result: "cause", cause: CAUSES.input },
  { command: "bash x.sh <<EOF\nEOF", result: "cause", cause: CAUSES.input },
  { command: "arr['b[$(git push)]']=1", result: "cause", cause: CAUSES.array },
  { command: "/usr/bin/git -C . --no-pager push origin", result: "match" },
  { command: "git -c alias.p=push p", result: "cause", cause: CAUSES.gitConfig },
  { command: "git -c help.autocorrect=immediate psuh", result: "cause", cause: CAUSES.gitConfig },
  { command: "git --frobnicate push", result: "cause", cause: CAUSES.option },
  { command: "git -Cx status", result: "cause", cause: CAUSES.option },
  { command: "git -C=x status", result: "cause", cause: CAUSES.option },
  { command: "git --list-cmds main status", result: "pass", stub: "git" },
  { command: 'git $"status"', result: "cause", cause: CAUSES.expansion },
  { command: "git --frobnicate status", entries: ["herdr"], result: "pass" },
  { command: "git grep -O'git push' hi", result: "match" },
  { command: "git clone -u 'git push' . x", result: "match" },
  { command: "git -c core.fsmonitor='git push' status", result: "cause", cause: CAUSES.gitConfig },
  { command: "git -c user.name=x commit", result: "cause", cause: CAUSES.gitConfig },
  { command: "GIT_EDITOR='git push' git commit", result: "match" },
  { command: "EDITOR='git push'", result: "match" },
  { command: "VISUAL='git push'", result: "match" },
  { command: "PAGER='git push'", result: "match" },
  { command: "GIT_PAGER='git push'", result: "match" },
  { command: "local EDITOR='git push'", result: "match" },
  { command: "local VISUAL='git push'", result: "match" },
  { command: "local PAGER='git push'", result: "match" },
  { command: "local GIT_PAGER='git push'", result: "match" },
  { command: "declare EDITOR='git push'", result: "match" },
  { command: "declare VISUAL='git push'", result: "match" },
  { command: "declare PAGER='git push'", result: "match" },
  { command: "declare GIT_PAGER='git push'", result: "match" },
  { command: "export EDITOR='git push'", result: "match" },
  { command: "export VISUAL='git push'", result: "match" },
  { command: "export PAGER='git push'", result: "match" },
  { command: "export GIT_PAGER='git push'", result: "match" },
  { command: "env EDITOR='git push'", result: "match" },
  { command: "env VISUAL='git push'", result: "match" },
  { command: "env PAGER='git push'", result: "match" },
  { command: "env GIT_PAGER='git push'", result: "match" },
  { command: "typeset EDITOR='git push'", result: "match" },
  { command: "readonly GIT_PAGER='git push'", result: "match" },
  { command: "GIT_X='git push'", result: "match" },
  { command: "GIT_X=$(echo a) git status", result: "cause", cause: CAUSES.gitConfig },
  { command: "git rebase -x 'git push' HEAD~1", result: "match" },
  { command: "git --config-env a=B status", result: "cause", cause: CAUSES.gitConfig },
  { command: "git rebase --exec='git push' HEAD", result: "match" },
  { command: "git bisect run git push", result: "match" },
  { command: "git submodule foreach 'git push'", result: "match" },
  { command: "git difftool -x 'git push'", result: "match" },
  { command: "git filter-branch --tree-filter 'git push' HEAD", result: "match" },
  { command: "git fetch --upload-pack='git push' .", result: "match" },
  { command: "git pull --upload-pack 'git push' .", result: "match" },
  { command: "git ls-remote --upload-pack='git push' .", result: "match" },
  { command: "git archive --exec='git push' HEAD", result: "match" },
  { command: "find . -exec echo ok \\; -exec git push \\;", result: "match" },
  { command: "find . -ok git push \\;", result: "match" },
  { command: "find . -okdir git push \\;", result: "match" },
  { command: "printf -v 'a[$(git push)]' x", result: "cause", cause: CAUSES.array },
  { command: "read 'a[$(git push)]' < /dev/null", result: "cause", cause: CAUSES.array },
  { command: "unset 'a[$(git push)]'", result: "cause", cause: CAUSES.array },
  { command: "test -v 'a[$(git push)]'", result: "cause", cause: CAUSES.array },
  { command: "git commit -m 'git push'", result: "pass", stub: "git" },
  { command: "grep -rn 'git push' docs", result: "pass", stub: "grep" },
  { command: "xargs --version", result: "pass", stub: "xargs" },
  { command: "xargs ls", result: "pass", stub: "xargs" },
  { command: "xargs -0 ls", result: "pass", stub: "xargs" },
  { command: "xargs echo", result: "pass", stub: "xargs" },
  { command: "env -i A=b git push", result: "match" },
  { command: "nice -n 5 timeout 9 git push", result: "match" },
  { command: "echo git push | xargs env", result: "cause", cause: CAUSES.xargs },
  { command: "find . -name '*.ts' -exec git push \\;", result: "match" },
  { command: "find . -name git -exec {} push \\;", result: "cause", cause: CAUSES.expansion },
  { command: "find . -name *.ts -print", result: "pass" },
  { command: "find . *", result: "cause", cause: CAUSES.expansion },
  { command: "timeout 60 npm test -- $FILE", result: "cause", cause: CAUSES.expansion },
  { command: "echo push | xargs git", result: "cause", cause: CAUSES.xargs },
  { command: "xargs -I{} sh -c '{}'", result: "cause", cause: CAUSES.xargs },
  { command: "xargs grep -l git", result: "cause", cause: CAUSES.xargs },
  { command: "find . -exec {} push \\;", result: "cause", cause: CAUSES.expansion },
  { command: "find . -exec sh -c '{}' \\;", result: "cause", cause: CAUSES.expansion },
];

function expectedResult(row: CommandRow): { block: false } | { block: true; reason: string } {
  if (row.result === "pass") return { block: false };
  if (row.result === "match") {
    const entry = row.entry ?? DENIED;
    return { block: true, reason: `tasker blocked this command: it runs "${entry}", which this run must not run.` };
  }
  return {
    block: true,
    reason: `tasker blocked this command: the guard extension cannot read it with certainty (${row.cause ?? ""}).`,
  };
}

function runPassingCommand(command: string): string {
  const root = useTempDir("tasker-bash-check-");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  writeFileSync(log, "");

  for (const name of [
    "git",
    "herdr",
    "echo",
    "false",
    "ls",
    "cat",
    "npm",
    "bash",
    "grep",
    "find",
    "zsh",
    "ksh",
    "dash",
    "rbash",
    "ash",
    "mksh",
    "yash",
    "env",
    "nice",
    "timeout",
    "watch",
    "nohup",
    "command",
    "stdbuf",
    "sudo",
    "exec",
    "doas",
    "setsid",
    "ionice",
    "chrt",
    "taskset",
    "flock",
    "busybox",
    "su",
    "script",
    "xargs",
  ]) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> "$TASKER_BASH_STUB_LOG"\n`);
    chmodSync(path, 0o755);
  }

  const result = spawnSync("/bin/bash", ["-c", command], {
    cwd: root,
    encoding: "utf8",
    input: "",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TASKER_BASH_STUB_LOG: log,
    },
  });
  expect(result.error).toBeUndefined();
  const records = readFileSync(log, "utf8");
  expect(records).not.toMatch(/^git push(?:\s|$)/mu);
  expect(records).not.toMatch(/^herdr(?:\s|$)/mu);
  return records;
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function commandAtDepth(depth: number): string {
  let command = "git status";
  for (let nested = 1; nested < depth; nested += 1) command = "bash -c " + shellQuote(command);
  return command;
}

function assignmentReaderAtDepth(depth: number): string {
  let command = "git status";
  for (let nested = 1; nested < depth; nested += 1) command = `GIT_EDITOR=${shellQuote(command)} true`;
  return command;
}

function gitReaderAtDepth(depth: number): string {
  let command = "git status";
  for (let nested = 1; nested < depth; nested += 1) command = `git clone -u ${shellQuote(command)} . x`;
  return command;
}

describe("checkBashCommand", () => {
  it.each(commandRows)("checks $command", (row) => {
    expect(checkBashCommand(row.command, row.entries ?? [DENIED])).toEqual(expectedResult(row));
  });

  it("runs every passing table row through bash with stub commands", () => {
    const passingRows = commandRows.filter((row) => row.result === "pass");
    const records = passingRows.map((row) => runPassingCommand(row.command));

    passingRows.forEach((row, index) => {
      if (row.stub !== undefined) expect(records[index]).toContain(`${row.stub} `);
    });

    expect(records.length).toBeGreaterThan(0);
  }, 60000);

  it("chooses a denied match before a cause", () => {
    expect(checkBashCommand("echo $X; git push", [DENIED])).toEqual({
      block: true,
      reason: `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    });
  });

  it("chooses the first denied entry from the entry list", () => {
    expect(checkBashCommand("herdr agent list && git push", [DENIED, "herdr"])).toEqual({
      block: true,
      reason: `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    });
  });

  it("blocks a parse error after an earlier valid command", () => {
    expect(checkBashCommand("echo ok\necho hi; )", [DENIED])).toEqual({
      block: true,
      reason: `tasker blocked this command: the guard extension cannot read it with certainty (${CAUSES.parse}).`,
    });
  });

  it("blocks an internal error in the guard", () => {
    const entries = new Proxy([DENIED], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("internal test error");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(checkBashCommand("git status", entries)).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (an error in the guard extension).",
    });
  });

  it("allows eight command-line levels and blocks nine", () => {
    expect(checkBashCommand(commandAtDepth(8), [DENIED])).toEqual({ block: false });
    expect(checkBashCommand(commandAtDepth(9), [DENIED])).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (the command lines are nested more than 8 levels deep).",
    });
  });

  it.each([assignmentReaderAtDepth, gitReaderAtDepth])(
    "counts reparsed reader strings at depth eight and nine",
    (atDepth) => {
      expect(checkBashCommand(atDepth(8), [DENIED])).toEqual({ block: false });
      expect(checkBashCommand(atDepth(9), [DENIED])).toEqual({
        block: true,
        reason:
          "tasker blocked this command: the guard extension cannot read it with certainty (the command lines are nested more than 8 levels deep).",
      });
    },
  );

  it("records the first cause by command text order", () => {
    expect(checkBashCommand('bash -c "$X"; hash -p /usr/bin/git g', [DENIED])).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (" + CAUSES.expansion + ").",
    });
  });
});
