<link href="{{basePath}}client/modules/crm/css/vis.css" rel="stylesheet"> 
{{#if header}}  
    <div class="row button-container">  
        <div class="col-sm-4 col-xs-12"> 
            <div class="btn-group range-switch-group">  
                <button class="btn btn-text btn-icon" data-action="prev">  
                    <span class="fas fa-chevron-left"></span>  
                </button>   
                <button class="btn btn-text btn-icon" data-action="next">  
                    <span class="fas fa-chevron-right"></span>  
                </button>
                <button class="btn btn-text" data-action="today">{{translate 'Today' scope='Calendar'}}
                </button> 
            </div>  
            <div class="btn-group"> 
                <button class="btn btn-text btn-icon" title="{{translate 'Refresh'}}" data-action="refresh">
                    <span class="fas fa-sync-alt"></span>
                </button>  
                <button class="btn btn-text btn-icon date-picker-btn" title="{{translate 'Go to Date' scope='Calendar'}}">
                    <span class="far fa-calendar"></span>
                </button>
                <button class="btn btn-text btn-icon" title="{{translate 'Print'}}" data-action="print">
                    <span class="fas fa-print"></span>
                </button> 
                <button class="btn btn-text btn-icon" title="{{translate 'Search'}}" data-action="findCommonSlots">
                    <span class="fas fa-user-group"></span>
                </button> 
            </div>

    {{#if calendarTypeSelectEnabled}}  
        <div class="btn-group calendar-type-button-group">    
            <div class="btn-group" role="group">    
                <button type="button" class="btn btn-text dropdown-toggle" data-toggle="dropdown">  
                    <span class="calendar-type-label">{{calendarTypeLabel}}</span>   
                    <span class="caret"></span>  
                </button>    
                <ul class="dropdown-menu">    
                    {{#each calendarTypeDataList}}    
                        <li>    
                            <a role="button" tabindex="0" data-action="toggleCalendarType" data-name="{{type}}">    
                                <span class="fas fa-check calendar-type-check-icon pull-right{{#if disabled}} hidden{{/if}}"></span>   
                                {{label}}    
                            </a>    
                        </li>    
                    {{/each}}
                    <li class="divider">
                        <!-- --> 
                    </li>  
                     
                </ul>
            </div>    
            <button class="btn btn-text{{#ifNotEqual calendarType 'shared'}} hidden{{/ifNotEqual}} btn-icon" data-action="showSharedCalendarOptions" title="{{translate 'Shared Mode Options' scope='Calendar'}}">  
                <span class="fas fa-pencil-alt fa-sm"></span>  
            </button>    
        </div>    
    {{/if}} 
    </div>  
    <div class="date-title col-sm-4 hidden-xs">  
        <h4><span style="cursor: pointer;" data-action="refresh" title="{{translate 'Refresh'}}"></span></h4>
    </div>  
    <div class="col-sm-4 col-xs-12">
            {{{modeButtons}}}  
        </div>  
    </div>
{{/if}}

<div class="timeline"></div>
