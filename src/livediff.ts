import * as vscode from 'vscode';
import * as util from './util';
import * as stack from './stack';
import * as child_process from 'child_process';
import * as yaml from 'yaml';
import * as output from './output';


const KUSION_LIVE_DIFF_EDITOR_OPEN = 'inKusionLiveDiff';

export function checkInLiveDiffTab(): boolean {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input && input instanceof vscode.TabInputTextDiff) {
        const original = input.original;
        const modified = input.modified;
        return (original && modified && original.scheme === 'kusion');
    }
    return false;
}

export function updateKusionLiveDiffEditorStatus(editor: vscode.TextEditor | undefined){
    if (editor && checkInLiveDiffTab()) {
        const allEditors = vscode.window.visibleTextEditors;
        for (const e of allEditors) {
            if (e.document.uri.scheme === 'kusion') {
                vscode.languages.setTextDocumentLanguage(e.document, 'yaml');
            }
        }
        util.setContextValue(KUSION_LIVE_DIFF_EDITOR_OPEN, true);
    } else {
        util.setContextValue(KUSION_LIVE_DIFF_EDITOR_OPEN, false);
    }
}

export async function showDiff(context: vscode.ExtensionContext, currentStack: stack.Stack){
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
   
    const editorOptions: vscode.TextDocumentShowOptions = {
        preserveFocus: false,
        preview: false,
        viewColumn: column
    };

    // runtime/status: kusion:${stackPath}?language=yaml#runtime
    // spec: kusion:${stackPath}?language=yaml#spec
    const previewResult: LiveDiffPreview = await livePreview(currentStack);
    const registration = vscode.workspace.registerTextDocumentContentProvider('kusion', {
        provideTextDocumentContent(uri) {
          switch (uri.fragment) {
              case 'runtime':
                  return yaml.stringify(previewResult.status);
              case 'spec':
                  return yaml.stringify(previewResult.spec);
              default:
                  return 'default';
          }
        }
    });
    vscode.commands.executeCommand('vscode.diff', 
      vscode.Uri.parse(`kusion:${vscode.Uri.joinPath(currentStack.uri, 'status').fsPath}?language=yaml#runtime`), 
      vscode.Uri.parse(`kusion:${vscode.Uri.joinPath(currentStack.uri, 'spec').fsPath}?language=yaml#spec`),
      `${currentStack.name} (Runtime) ↔ (Spec)`, 
      editorOptions).then(
        value => {
            value;
            registration.dispose();
            util.setContextValue(KUSION_LIVE_DIFF_EDITOR_OPEN, true);
        }
    );
}


function livePreview(currentStack: stack.Stack): Promise<LiveDiffPreview> {
  return new Promise((resolve, reject) => {
    // todo: before release, if stack defination changed, the currentStack.name should change to fullName
    child_process.exec(`kusion preview -w ${currentStack.name} --output json`, {cwd: currentStack.kclWorkspaceRoot?.path}, (error, stdout, stderr) => {
      if (stdout) {
        try {
          const result = JSON.parse(stdout) as ChangeOrder;
          const status: {[key: string]: object} = {};
          const spec: {[key: string]: object} = {};
          const steps = result.changeSteps;
          for (const key in steps) {
            if (steps.hasOwnProperty(key)) {
              const step = steps[key];
              status[step.id] = step.from;
              spec[step.id] = step.to;
            }
          }
          resolve(new LiveDiffPreview(status, spec));
        } catch (e) {
          console.log(`not json: ${stdout}`);
          if (error || stderr) {
            console.error(`kusion preview --output json exec error: ${error}, ${stderr}`);
            output.show();
            output.appendLine(`kusion Preview failed:`, false);
            output.appendLine(stdout, true);
            reject(error || stderr);
          }
        }
      }
    });
  });
}

class LiveDiffPreview {
  status: {[key: string]: object};
  spec: {[key: string]: object};

  constructor(status: {[key: string]: object}, spec: {[key: string]: object}) {
    this.status = status;
    this.spec = spec;
  }
}

class ChangeOrder {
  stepKeys: string[];
  changeSteps: ChangeSteps;

  constructor(stepKeys: string[], changeSteps: ChangeSteps) {
    this.stepKeys = stepKeys;
    this.changeSteps = changeSteps;
  }
}

interface ChangeSteps {
  [key: string]: ChangeStep;
}

class ChangeStep {
  // the resource id
	id: string;
	// the operation performed by this step
	action: ActionType;
	// old data
	from: object;
	// new data
	to: object;

  constructor(id: string, action: ActionType, from: object, to: object) {
    this.id = id;
    this.action = action;
    this.from = from;
    this.to = to;
  }
}

class Resource {}

export enum ActionType {
  unChange = "Unchange",                  // nothing to do.
	create = "Create",                      // creating a new resource.
	update = "Update",                      // updating an existing resource.
	delete = "Delete",                      // deleting an existing resource.
}