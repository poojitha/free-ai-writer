export namespace main {
	
	export class AIConfig {
	    provider: string;
	    host: string;
	    model: string;
	    apiKey: string;
	
	    static createFrom(source: any = {}) {
	        return new AIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.host = source["host"];
	        this.model = source["model"];
	        this.apiKey = source["apiKey"];
	    }
	}
	export class ProviderDefaults {
	    host: string;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.model = source["model"];
	    }
	}
	export class DefaultSettings {
	    prompt: string;
	    actionPrompts: Record<string, string>;
	    providers: Record<string, ProviderDefaults>;
	
	    static createFrom(source: any = {}) {
	        return new DefaultSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.prompt = source["prompt"];
	        this.actionPrompts = source["actionPrompts"];
	        this.providers = this.convertValues(source["providers"], ProviderDefaults, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Document {
	    path: string;
	    data: number[];
	
	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.data = source["data"];
	    }
	}

}

