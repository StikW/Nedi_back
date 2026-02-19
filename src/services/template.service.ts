import { Injectable, Global } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Global()
@Injectable()
export class TemplateService {
  private readonly templatesPath: string;

  constructor() {
    this.templatesPath = path.join(process.cwd(), 'src', 'templates');
  }

  /**
   * Carga un template desde un archivo JSON y reemplaza las variables
   * @param templateName Nombre del archivo template (sin extensión)
   * @param variables Objeto con las variables a reemplazar
   * @returns El objeto JSON procesado
   */
  loadTemplate(templateName: string, variables: Record<string, any>): any {
    try {
      const templatePath = path.join(this.templatesPath, `${templateName}.json`);
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      
      // Reemplazar variables en el template
      let processedContent = templateContent;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        processedContent = processedContent.replace(new RegExp(placeholder, 'g'), value);
      }
      
      return JSON.parse(processedContent);
    } catch (error) {
      throw new Error(`Error cargando template ${templateName}: ${error.message}`);
    }
  }

  /**
   * Carga el template de workflow específico
   * @param workflowName Nombre del workflow
   * @returns El objeto JSON del workflow procesado
   */
  loadWorkflowTemplate(workflowName: string): any {
    return this.loadTemplate('workflow-template', {
      workflowName: workflowName
    });
  }

  /**
   * Carga el template de workflow con credenciales específicas
   * @param workflowName Nombre del workflow
   * @param credentials Objeto con las credenciales
   * @returns El objeto JSON del workflow procesado con credenciales
   */
  loadWorkflowTemplateWithCredentials(
    workflowName: string, 
    credentials?: {
      whatsAppTriggerApiId: string;
      whatsAppTriggerApiName: string;
      openAiApiId: string;
      openAiApiName: string;
      httpBearerAuthId: string;
      httpBearerAuthName: string;
      whatsAppApiId: string;
      whatsAppApiName: string;
    }
  ): any {
    const variables = {
      workflowName: workflowName,
      ...(credentials || {})
    };
    return this.loadTemplate('workflow-template', variables);
  }
}
